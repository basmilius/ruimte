import { cancellableTimeout, Serializer } from '@adecore/utils/async';
import type { TunnelExisting, TunnelNamed, TunnelOrigin, TunnelOtherRule, TunnelRow, TunnelRowKind, TunnelStage, TunnelState } from '@ruimte/contracts';
import { errorText } from '../error-text.ts';
import type { JsonFileStore } from '../json-file-store.ts';
import {
    CloudflareApi,
    CloudflareError,
    isDashboardManaged,
    isRunning,
    type CloudflareFetch,
    type CloudflareIngressRule,
    type CloudflareRecord,
    type CloudflareZone
} from './cloudflare-api.ts';
import type { CloudflareTokenStore } from './cloudflare-token-store.ts';
import type { CloudflaredInstaller } from './cloudflared-installer.ts';
import type { CloudflaredProcess, CloudflaredRunner } from './cloudflared-runner.ts';
import {
    CATCH_ALL,
    deniedPortReason,
    hostnameInZone,
    type IngressRule,
    ingressRules,
    isCatchAll,
    machineMarkOf,
    normalizedOrigin,
    servedBy,
    servedFor,
    takesHost,
    TunnelConfigError,
    tunnelNameOf
} from './tunnel-config.ts';
import { EMPTY_TUNNELS, type StoredRow, type StoredTunnels } from './tunnel-store.ts';

const MAX_MESSAGE = 500;
const STOP_WAIT_MS = 10_000;
const RECORD_MARK = 'Managed by Ruimte';
const TUNNEL_TARGET = 'cfargotunnel.com';
const TOKEN_MASK = '[token]';
const MAX_OTHER_RULES = 200;

/* The lines `cloudflared` printed, cut to the one a person can read: the last, without its clock and level. */
export function sentenceOf(lines: readonly string[], fallback: string): string {
    const last = [...lines].reverse().find((line) => line.trim() !== '');

    if (last === undefined) {
        return fallback;
    }

    const plain = last
        .replace(/^\S+Z\s+(ERR|WRN|INF|DBG)\s+/, '')
        .replace(/^(error|Error)[: ]+/, '')
        .trim();

    return plain.slice(0, MAX_MESSAGE);
}

/* A rule someone else wrote, cut to what the screen shows. */
function otherRuleOf(rule: CloudflareIngressRule): TunnelOtherRule {
    const text = (value: unknown, max: number): string | null => (typeof value === 'string' && value !== '' ? value.slice(0, max) : null);

    const originRequest = typeof rule.originRequest === 'object' && rule.originRequest !== null ? (rule.originRequest as Record<string, unknown>) : {};
    const hostHeader = text(originRequest.httpHostHeader, 500);

    return {
        hostname: text(rule.hostname, 253),
        path: text(rule.path, 500),
        service: text(rule.service, 500) ?? '',
        ...(hostHeader === null ? {} : { hostHeader })
    };
}

/*
 * Whether a rule someone else wrote could take the traffic of a hostname. One without a hostname or with `*` takes its
 * path on every host, and a wildcard counts for every name under it. A path on the hostname itself is the person's: it
 * keeps serving its path while the row is on, and a row held off goes before it, whatever its path.
 */
function mayCatch(rule: CloudflareIngressRule, hostname: string, held: boolean): boolean {
    if (!takesHost(rule, hostname)) {
        return false;
    }

    return rule.hostname !== hostname || held;
}

/* Whether Ruimte's own rule for a hostname is there and no rule of someone else's that could catch it comes before it. */
function comesFirst(ingress: readonly CloudflareIngressRule[], hostname: string, held: boolean): boolean {
    const own = ingress.findIndex((rule) => rule.hostname === hostname && rule.path === undefined);

    return own >= 0 && !ingress.slice(0, own).some((rule) => mayCatch(rule, hostname, held));
}

/* JSON with the keys of every object sorted, since Cloudflare need not send a rule's keys back in the order Ruimte wrote them. */
function canonical(value: unknown): string {
    return JSON.stringify(value, (_key, inner: unknown) =>
        typeof inner === 'object' && inner !== null && !Array.isArray(inner)
            ? Object.fromEntries(Object.entries(inner).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
            : inner
    );
}

export interface TunnelPorts {
    store: Pick<JsonFileStore<StoredTunnels>, 'read' | 'write'>;
    installer: Pick<CloudflaredInstaller, 'locate' | 'install' | 'impossible'>;
    runner: CloudflaredRunner;
    /* Where the API token lives. */
    tokens: CloudflareTokenStore;
    /* The network, for `api.cloudflare.com` and nothing else. */
    cloudflare: CloudflareFetch;
    /* The name of this machine, which names its tunnel in the Cloudflare dashboard. */
    machineName(): string;
    /* The id of this machine, a piece of which keeps its tunnel apart from one of another machine with the same name. */
    machineId(): string;
    /* The ports Ruimte listens on, which no dev server row may name. */
    deniedPorts(): readonly number[];
    /* Starts or stops the external listener; the port it listens on while it is on. */
    setListener(enabled: boolean): Promise<number | null>;
    listenerPort(): number | null;
    /* How many credentials were used lately. */
    clients(): number;
    /* Ports with a server on them that a session of this machine started. */
    discover(): Promise<Array<{ port: number; session: string | null }>>;
    /* Tells every client the state moved. */
    changed(): void;
    /* A string of random hex digits, `bytes` bytes long. */
    random(bytes: number): string;
    log(line: string): void;
    /* Waits for the child to end after a stop; a test resolves it at once. */
    stopWaitMs?: number;
}

type Busy = 'installing' | 'checking' | 'starting' | null;
type Served = NonNullable<ReturnType<typeof servedBy>>;

/* What the person asked of a row: on, and not on its way out. */
function meantOn(row: StoredRow): boolean {
    return row.enabled && row.leaving !== true;
}

/* A failure that may pass by itself: no answer, a 5xx or Cloudflare asking Ruimte to wait. */
function passing(e: unknown): boolean {
    return e instanceof CloudflareError && (e.code === 'unreachable' || e.code === 'rate-limited' || (e.status !== null && e.status >= 500));
}

const NOT_SERVED = 'Cloudflare does not serve it as Ruimte wrote it. Try again to put its rule back.';

function noRecordYet(hostname: string): string {
    return `Ruimte has not made the DNS record of ${hostname} yet. Try again.`;
}

interface Lookup {
    looked: boolean;
}

interface Landing {
    sent: boolean;
    ruled: ReadonlySet<string> | null;
}

/*
 * Tunnels on this machine: one tunnel on the person's own Cloudflare account, whose hostnames live in Cloudflare
 * (the dashboard shows the same), and a `cloudflared` that runs it unless something else already does. The tunnel is
 * one Ruimte made or one the person picked. Ruimte reaches Cloudflare only with the API token the person typed, and
 * changes only its own rules on that tunnel and the DNS records it made for it. The token that runs the tunnel is
 * fetched when the child starts and goes to the child's environment, never to a command line or a file.
 */
export class TunnelService {
    private readonly ports: TunnelPorts;
    private readonly jobs = new Serializer();
    private stored: StoredTunnels;
    private token: string | null;
    private zones: CloudflareZone[] = [];
    private busy: Busy = null;
    /* Jobs of `start` queued or running, so only the last one to end clears `busy`. */
    private queued = 0;
    private failure: string | null = null;
    private installFailed = false;
    private child: { process: CloudflaredProcess; lines: string[]; stopping: boolean } | null = null;
    private binary: string | null = null;
    private pending: Promise<void> = Promise.resolve();
    private stopped = false;
    /* The last job failed because Cloudflare could not be reached, failed itself or asked Ruimte to wait, so the network coming back tries again. */
    private waitsForNetwork = false;
    /* The network came back while a job ran, so that job failing on the network tries once more. */
    private networkReturned = false;
    /* Something other than Ruimte ran the tunnel when Ruimte last looked, so it started no child of its own. */
    private runsElsewhere = false;
    /* The rules on the tunnel that are not Ruimte's, from the last time Ruimte read its configuration. */
    private others: TunnelOtherRule[] = [];
    /*
     * Rows Cloudflare may serve whatever their intent says, as Ruimte last saw it, with the port and origin of a rule it
     * could read. Only an observation: it never goes into the stored rows, and a write that held clears it.
     */
    private readonly serving = new Map<string, Served>();
    /* Ruimte does not know what Cloudflare serves (a boot, or a write that may have landed unread), so it reads that before the next change. */
    private unsure: boolean;
    /* Rows meant on whose record a bring-up could not make, held with their 404 until one does. Never saved. */
    private readonly unrecorded = new Set<string>();
    /* Why a row meant on is not served, kept until a write serves it, so the row says it after the job that found it ended. Never saved. */
    private readonly reasons = new Map<string, string>();
    /* Why the listener the person turned on is not listening (its port taken, say), until it starts. Never saved. */
    private listenerFailure: string | null = null;

    constructor(ports: TunnelPorts) {
        this.ports = ports;
        this.stored = ports.store.read() ?? EMPTY_TUNNELS;
        this.token = ports.tokens.read();

        // Nothing of what Cloudflare served before the restart is known, so every row may serve until Ruimte read it.
        for (const row of this.stored.rows) {
            this.serving.set(row.id, {});
        }

        this.unsure = this.stored.tunnel !== null && this.stored.rows.length > 0;
    }

    /* Resolves once the work a request started has ended, with any work that work started in turn. */
    async idle(): Promise<void> {
        let seen: Promise<void>;

        do {
            seen = this.pending;
            await seen;
        } while (seen !== this.pending);
    }

    async state(): Promise<TunnelState> {
        this.binary = await this.ports.installer.locate();

        return this.describe();
    }

    private accounts(): TunnelNamed[] {
        const found = new Map<string, TunnelNamed>();

        for (const zone of this.zones) {
            found.set(zone.account.id, zone.account);
        }

        return [...found.values()];
    }

    private describe(): TunnelState {
        const { stage, message } = this.stageOf();
        const accounts = this.accounts();
        const account = this.stored.tunnel?.account ?? (accounts.length === 1 ? accounts[0]! : null);

        return {
            stage,
            message,
            hasToken: this.token !== null,
            accounts,
            account,
            zones: account === null ? [] : this.zones.filter((zone) => zone.account.id === account.id).map(({ id, name }) => ({ id, name })),
            zoneCount: this.zones.length,
            tunnel:
                this.stored.tunnel === null
                    ? null
                    : {
                          name: this.stored.tunnel.name,
                          created: this.stored.tunnel.created,
                          runner: this.child !== null ? 'ruimte' : this.runsElsewhere ? 'other' : null,
                          others: this.others
                      },
            rows: this.stored.rows.map((row) => this.shown(row)),
            mcp: {
                enabled: this.stored.mcp.enabled,
                port: this.ports.listenerPort(),
                ...(this.listenerFailure === null ? {} : { failure: this.listenerFailure.slice(0, MAX_MESSAGE) })
            },
            clients: this.ports.clients(),
            suggestedMcpLabel: this.stored.tunnel === null ? null : this.stored.mcp.label
        };
    }

    /* A row on while it is meant on or Cloudflare may serve it, with the port and origin Cloudflare serves where Ruimte read them. */
    private shown(row: StoredRow): TunnelRow {
        const served = this.serving.get(row.id);
        const read = row.kind === 'dev' && served?.port !== undefined ? served : null;
        const origin = read === null ? row.origin : read.origin;
        // The MCP the person turned off serves nothing by their own choice, which needs no reason.
        const quiet = !meantOn(row) || (row.kind === 'mcp' && !this.stored.mcp.enabled);
        const reason =
            row.leaving === true ? this.unfinished(row) : quiet ? undefined : (this.portRefusal(row) ?? this.listenerRefusal(row) ?? this.noted(row));

        return {
            id: row.id,
            kind: row.kind,
            hostname: row.hostname,
            port: read?.port ?? row.port,
            enabled: meantOn(row) || served !== undefined,
            comeBack: row.comeBack,
            ...(origin === undefined ? {} : { origin }),
            ...(reason === undefined ? {} : { reason: reason.slice(0, MAX_MESSAGE) })
        };
    }

    private listening(): boolean {
        return this.stored.mcp.enabled && this.ports.listenerPort() !== null;
    }

    /* A row stays leaving only between the steps of a Remove or unlink, or after one that did not finish, also before a restart. */
    private unfinished(row: StoredRow): string {
        const tunnel = this.stored.tunnel;

        return tunnel?.leaving === true
            ? `Ruimte has not finished unlinking ${tunnel.name}. Try again to finish.`
            : `Ruimte has not finished removing ${row.hostname}. Try again to finish.`;
    }

    /* Why the MCP row serves nothing while the person has the MCP on: its listener did not start. */
    private listenerRefusal(row: StoredRow): string | null {
        if (row.kind !== 'mcp' || this.ports.listenerPort() !== null) {
            return null;
        }

        return this.listenerFailure ?? 'The MCP listener is not running. Try again to start it.';
    }

    /*
     * Starts the listener the person turned on when it is not listening, at boot or after its port was taken. A failure
     * is kept for the screen and holds up nothing else, so the other rows still come up.
     */
    private async ensureListener(): Promise<void> {
        if (!this.stored.mcp.enabled || this.ports.listenerPort() !== null) {
            this.listenerFailure = null;

            return;
        }

        try {
            const port = await this.ports.setListener(true);

            this.listenerFailure = port === null ? 'The MCP listener did not start. Try again.' : null;
        } catch (e) {
            this.listenerFailure = `The MCP listener did not start. ${this.plain(e, 'Its port may be in use.')}`;
        }

        if (this.listenerFailure !== null) {
            this.ports.log(`Tunnels: ${this.listenerFailure}`);
        }
    }

    /* Why a dev row may not point at its port, which changes when the ports Ruimte listens on do. */
    private portRefusal(row: StoredRow): string | null {
        if (row.kind !== 'dev') {
            return null;
        }

        return row.port === null ? 'A dev server needs a port' : deniedPortReason(row.port, this.ports.deniedPorts());
    }

    /* What a job noted about a row, where a missing record says more than a rule that does not serve. */
    private noted(row: StoredRow): string | undefined {
        const reason = this.reasons.get(row.id);

        return (reason === undefined || reason === NOT_SERVED ? this.recordRefusal(row) : null) ?? reason;
    }

    /* Why a row has no record of this machine, read from the stored row, so it says so after a restart too. */
    private recordRefusal(row: StoredRow): string | null {
        return row.recordId === null ? noRecordYet(row.hostname) : null;
    }

    /* A row meant on that Ruimte holds with its 404 whatever the person asked: its record is missing, or its port is Ruimte's own. */
    private blocked(row: StoredRow): boolean {
        return this.unrecorded.has(row.id) || row.recordId === null || this.portRefusal(row) !== null;
    }

    private stageOf(): { stage: TunnelStage; message: string | null } {
        if (this.busy === 'installing') {
            return { stage: 'installing', message: null };
        }

        if (this.binary === null) {
            const impossible = this.ports.installer.impossible();

            if (impossible !== null) {
                return { stage: 'cannot-install', message: impossible };
            }

            return this.installFailed ? { stage: 'failed', message: this.failure } : { stage: 'not-installed', message: null };
        }

        // A listener that did not start is said at the MCP switch and on its row, so it hides no step of the tunnel.
        if (this.failure !== null && this.busy === null) {
            return { stage: 'failed', message: this.failure };
        }

        if (this.busy === 'checking') {
            return { stage: 'checking', message: null };
        }

        if (this.token === null) {
            return { stage: 'no-token', message: null };
        }

        if (this.stored.tunnel === null) {
            return { stage: this.busy === 'starting' ? 'starting' : 'no-tunnel', message: null };
        }

        return { stage: this.busy === 'starting' ? 'starting' : 'running', message: null };
    }

    private save(): void {
        this.ports.store.write(this.stored);
    }

    private announce(): void {
        this.ports.changed();
    }

    /* Anything a sentence can carry out of this service, without the token of Cloudflare or the one that runs the tunnel. */
    private plain(e: unknown, fallback: string): string {
        if (e instanceof TunnelConfigError || e instanceof CloudflareError) {
            return e.message;
        }

        return this.masked(sentenceOf([errorText(e)], fallback));
    }

    private masked(text: string, ...secrets: Array<string | null>): string {
        return [this.token, ...secrets].reduce<string>((safe, secret) => (secret === null || secret === '' ? safe : safe.replaceAll(secret, TOKEN_MASK)), text);
    }

    /* Starts a job in the background, behind the one before it, and tells the clients when it ended. */
    private start(busy: Exclude<Busy, null>, work: () => Promise<void>): void {
        if (this.stopped) {
            return;
        }

        const begin = (): void => {
            this.busy = busy;
            this.failure = null;
            this.waitsForNetwork = false;
        };

        // A job queued behind another one leaves the screen to that one until its own turn comes.
        this.queued += 1;

        if (this.queued === 1) {
            begin();
        }

        this.announce();
        this.pending = this.jobs
            .run(async () => {
                begin();
                this.announce();

                try {
                    await this.childInLine(work);
                } catch (e) {
                    this.waitsForNetwork = passing(e);
                    this.failure = this.plain(e, 'That did not work');
                    this.ports.log(`Tunnels: ${this.failure}`);
                } finally {
                    this.queued -= 1;

                    if (this.queued === 0) {
                        this.busy = null;
                    }

                    this.announce();
                }
            })
            .catch(() => undefined)
            .then(() => {
                const returned = this.networkReturned;

                this.networkReturned = false;

                if (returned && this.waitsForNetwork && this.token !== null) {
                    this.start('checking', () => this.refresh());
                } else if (returned) {
                    this.retryListener();
                }
            });
    }

    private requireToken(): string {
        if (this.token === null) {
            throw new TunnelConfigError('no-token', 'Add a Cloudflare API token first');
        }

        return this.token;
    }

    private api(): CloudflareApi {
        return new CloudflareApi(this.requireToken(), this.ports.cloudflare);
    }

    async install(): Promise<TunnelState> {
        this.binary = await this.ports.installer.locate();

        if (this.binary === null) {
            this.installFailed = false;
            this.start('installing', async () => {
                try {
                    this.binary = await this.ports.installer.install();
                } catch (e) {
                    this.installFailed = true;

                    throw e;
                }
            });
        }

        return this.describe();
    }

    /* Checks the token with Cloudflare, lists the zones it reaches, and keeps it only when both work. */
    async setToken(raw: string): Promise<TunnelState> {
        const token = raw.trim();

        await this.jobs.run(async () => {
            const api = new CloudflareApi(token, this.ports.cloudflare);

            await api.verifyToken();

            const zones = await api.zones();

            if (zones.length === 0) {
                throw new TunnelConfigError('no-zones', 'This API token reaches no domain. Give it Zone read on the domains you want to use.');
            }

            await this.ports.tokens.write(token);
            this.token = token;
            this.zones = zones;
            this.failure = null;
            // A bring-up, also without a tunnel to bring up.
            await this.ensureListener();
        });
        this.binary = await this.ports.installer.locate();

        if (this.stored.tunnel === null) {
            this.announce();
        } else {
            this.start('checking', () => this.bringUp());
        }

        return this.describe();
    }

    /* Forgets the token and stops the child. The tunnel and its records stay in Cloudflare, as they are. */
    async clearToken(): Promise<TunnelState> {
        await this.jobs.run(async () => {
            await this.stopChild();
            await this.ports.tokens.clear();
            this.token = null;
            this.zones = [];
            this.failure = null;
        });
        this.announce();

        return this.describe();
    }

    /* The account a request names, or the only one the token reaches, while this machine has no tunnel yet. */
    private accountForNewTunnel(accountId: string | undefined): TunnelNamed {
        if (this.token === null || this.stored.tunnel !== null) {
            throw new TunnelConfigError('wrong-stage', this.token === null ? 'Add a Cloudflare API token first' : 'This machine has a tunnel already');
        }

        const accounts = this.accounts();
        const account = accountId === undefined ? (accounts.length === 1 ? accounts[0] : undefined) : accounts.find((candidate) => candidate.id === accountId);

        if (account === undefined) {
            throw new TunnelConfigError('account-required', 'Pick the Cloudflare account that gets the tunnel');
        }

        return account;
    }

    /* Makes this machine's tunnel on the account, with its hostnames kept in Cloudflare. */
    async setup(accountId?: string): Promise<TunnelState> {
        const account = this.accountForNewTunnel(accountId);

        this.binary = await this.ports.installer.locate();
        this.start('starting', async () => {
            // A second press queued behind the first finds the tunnel the first one made or picked.
            if (this.stored.tunnel !== null) {
                return;
            }

            const api = this.api();
            const name = tunnelNameOf(this.ports.machineName(), this.ports.machineId());

            if ((await api.findTunnel(account.id, name)) !== null) {
                throw new TunnelConfigError(
                    'tunnel-exists',
                    `${account.name} has a tunnel named ${name} already. It may belong to another machine; if not, pick it under Your tunnels.`
                );
            }

            const created = await api.createTunnel(account.id, name);

            this.stored = {
                ...this.stored,
                tunnel: { id: created.id, name: created.name, account, created: true },
                mcp: { ...this.stored.mcp, label: `mcp-${this.ports.random(16)}` }
            };
            this.save();
            await this.commit(this.stored.rows);
        });

        return this.describe();
    }

    /* The tunnels already on the account, each with whether Ruimte can add hostnames to it and whether something runs it. */
    async existing(accountId?: string): Promise<TunnelExisting[]> {
        const account = this.accountForNewTunnel(accountId);
        const tunnels = await this.api().tunnels(account.id);

        return tunnels
            .filter((tunnel) => !tunnel.deleted_at)
            .map((tunnel) => ({ id: tunnel.id, name: tunnel.name, usable: isDashboardManaged(tunnel), running: isRunning(tunnel) }));
    }

    /*
     * Uses a tunnel the person already has. Only one whose settings live in the dashboard qualifies, since Ruimte adds
     * its hostnames through the API; every rule and record already on it stays as it is.
     */
    async link(accountId: string | undefined, tunnelId: string): Promise<TunnelState> {
        const account = this.accountForNewTunnel(accountId);

        this.binary = await this.ports.installer.locate();
        this.start('starting', async () => {
            if (this.stored.tunnel !== null) {
                return;
            }

            const found = await this.api().tunnel(account.id, tunnelId);

            if (found === null) {
                throw new TunnelConfigError('unknown-tunnel', `That tunnel is gone from ${account.name}.`);
            }

            if (!isDashboardManaged(found)) {
                throw new TunnelConfigError('tunnel-local', `${found.name} is managed in a file, not in the Cloudflare dashboard, so Ruimte cannot use it.`);
            }

            this.runsElsewhere = isRunning(found);
            this.stored = {
                ...this.stored,
                tunnel: { id: found.id, name: found.name, account, created: false },
                mcp: { ...this.stored.mcp, label: `mcp-${this.ports.random(16)}` }
            };
            this.save();
            await this.commit(this.stored.rows);
        });

        return this.describe();
    }

    /*
     * Stops using the tunnel: Ruimte takes its own rules off it, deletes the records it made and forgets it. The tunnel
     * itself stays in Cloudflare, whoever made it, and so does everything else on it. A refusal keeps what is left,
     * except when there is no token, Cloudflare refuses it or it cannot reach the tunnel's account: then Ruimte only
     * forgets the tunnel, and says so.
     */
    async unlink(): Promise<TunnelState> {
        if (this.stored.tunnel === null) {
            throw new TunnelConfigError('no-tunnel', 'This machine uses no tunnel');
        }

        await this.changing(async () => {
            const tunnel = this.stored.tunnel;

            if (tunnel === null) {
                return;
            }

            // Saved before anything is deleted, so Try again finishes the unlink instead of bringing the tunnel up.
            this.stored = { ...this.stored, tunnel: { ...tunnel, leaving: true } };
            this.intend(this.stored.rows.map((row) => ({ ...row, enabled: false, leaving: true })));
            await this.leave();
        });
        this.announce();

        return this.describe();
    }

    /* The work of an unlink, from the start or from where one that failed stopped. */
    private async leave(): Promise<void> {
        const tunnel = this.stored.tunnel;

        if (tunnel === null) {
            return;
        }

        const reached = this.token !== null && (this.zones.length === 0 || this.accounts().some((account) => account.id === tunnel.account.id));
        const api = reached ? this.api() : null;
        const found = api === null ? undefined : await api.tunnel(tunnel.account.id, tunnel.id).catch((e: unknown) => this.unlessRefused(e));

        // A token that cannot reach the tunnel's account cannot take anything off it, and the person still needs a way out.
        if (api === null || found === undefined) {
            await this.stopChild();
            this.forget();
            this.failure = `Ruimte forgot ${tunnel.name}, but its hostnames and DNS records stay in Cloudflare.`;

            return;
        }

        if (found !== null) {
            await this.commit(this.stored.rows);
        }

        await this.stopChild();

        // The rows stay until their rules are off as well, so a retry still knows which 404s are Ruimte's.
        for (const row of this.stored.rows) {
            await this.deleteRecordOf(api, row, tunnel.id);
        }

        // Another writer may put a rule of Ruimte's back, and only the rows still know it is Ruimte's to take off.
        if (
            found !== null &&
            !(await this.commit(
                this.stored.rows,
                this.stored.rows.map((row) => row.id)
            ))
        ) {
            const left = this.stored.rows.map((row) => row.hostname).join(', ');
            const incomplete = new TunnelConfigError(
                'unlink-incomplete',
                `Another change to ${tunnel.name} put back the rules of ${left}, so Ruimte has not finished unlinking it. Try again to take them off and finish.`
            );

            this.noteFailure(incomplete, incomplete.message);

            throw incomplete;
        }

        this.forget();
        this.failure = null;
    }

    /*
     * Puts a hostname on the tunnel: a 404 rule first, then the DNS record, then the rule that serves it. A name that has a
     * record Ruimte did not make is refused before anything is written.
     */
    async add(input: { kind: TunnelRowKind; zone: string; label: string; port?: number; comeBack?: boolean; origin?: TunnelOrigin }): Promise<TunnelState> {
        await this.changing(async () => {
            const tunnel = this.stored.tunnel;

            if (tunnel === null) {
                throw new TunnelConfigError('no-tunnel', 'Set up a tunnel first');
            }

            this.refuseWhileUnlinking();

            const api = this.api();

            await this.settleIfUnsure();

            const zone = this.zones.find((candidate) => candidate.id === input.zone && candidate.account.id === tunnel.account.id);

            if (zone === undefined) {
                throw new TunnelConfigError('unknown-zone', 'That domain is not on the Cloudflare account of this tunnel. Pick one from the list.');
            }

            const others = this.zones
                .filter((candidate) => candidate.id !== zone.id && candidate.account.id === zone.account.id)
                .map((candidate) => candidate.name);
            const hostname = hostnameInZone(input.label, zone.name, others);

            if (this.stored.rows.some((row) => row.hostname === hostname)) {
                throw new TunnelConfigError('hostname-taken', `${hostname} is on this tunnel already`);
            }

            let port: number | null = null;
            let origin: TunnelOrigin | undefined;

            if (input.kind === 'mcp') {
                if (this.stored.rows.some((row) => row.kind === 'mcp')) {
                    throw new TunnelConfigError('mcp-exists', 'The MCP already has a hostname. Remove that one first');
                }

                if (input.origin !== undefined) {
                    throw new TunnelConfigError('mcp-fixed', 'The MCP always points at Ruimte itself');
                }
            } else {
                origin = normalizedOrigin(input.origin);

                if (input.port === undefined) {
                    throw new TunnelConfigError('port-required', 'A dev server needs a port');
                }

                const reason = deniedPortReason(input.port, this.ports.deniedPorts());

                if (reason !== null) {
                    throw new TunnelConfigError('port-denied', reason);
                }

                port = input.port;
            }

            // A rule for the name that someone set in the dashboard is theirs, and taking the row would overwrite it.
            const { ingress } = await api.configuration(tunnel.account.id, tunnel.id);

            this.observe(ingress);

            if (ingress.some((rule) => rule.hostname === hostname)) {
                throw new TunnelConfigError('hostname-on-tunnel', `${hostname} is on this tunnel already. Pick another name.`);
            }

            const earlier = await this.ourRecordNamed(api, zone.id, hostname, tunnel.id);
            const row: StoredRow = {
                id: this.ports.random(6),
                kind: input.kind,
                hostname,
                port,
                enabled: false,
                // The MCP has a credential on every request and a hosted client cannot turn it on from outside; a dev server has no gate.
                comeBack: input.comeBack ?? input.kind === 'mcp',
                ...(origin === undefined ? {} : { origin }),
                zoneId: zone.id,
                recordId: earlier?.id ?? null
            };

            // A rule someone else set (a catch-all that serves) would answer the name the moment its record points at the
            // tunnel, so Cloudflare takes the 404 first. Saved off before that, so Remove still finds a 404 whose answer got
            // lost, and dropped again only when Cloudflare turned it down.
            this.stored = { ...this.stored, rows: [...this.stored.rows, row] };
            this.save();
            // Once more with the row: a record left under the name (an unlink that could not reach the tunnel) may already
            // lead to a rule that serves it.
            this.observe(ingress);

            const landing: Landing = { sent: false, ruled: null };
            let holds: boolean;

            try {
                holds = await this.commit(this.stored.rows, [], landing);
            } catch (e) {
                // An earlier write of the same commit may have landed the 404 before Cloudflare turned one down.
                const nothingLanded = !landing.sent || (landing.ruled !== null && !landing.ruled.has(hostname));

                if (e instanceof CloudflareError && e.refused && nothingLanded) {
                    this.stored = { ...this.stored, rows: this.stored.rows.filter((candidate) => candidate.id !== row.id) };
                    this.save();
                }

                throw e;
            }

            this.refuseUnheld(holds, tunnel.name, hostname);
            await this.recordRow(api, row, tunnel.id);
            this.refuseUnsettled(
                await this.commit(this.stored.rows.map((candidate) => (candidate.id === row.id ? { ...candidate, enabled: true } : candidate))),
                tunnel.name,
                hostname
            );
        });
        await this.followUp();

        return this.describe();
    }

    /* A new port or new origin settings of a row that is on reach Cloudflare first, like a switch does. */
    async update(id: string, change: { enabled?: boolean; comeBack?: boolean; port?: number; origin?: TunnelOrigin }): Promise<TunnelState> {
        const { origin: typedOrigin, ...flags } = change;
        const origin = normalizedOrigin(typedOrigin);
        const retargets = change.port !== undefined || change.origin !== undefined;

        // An origin sent replaces the one the row had, so a setting left out goes back to Cloudflare's default. Turning a
        // row on that Remove left halfway keeps it after all.
        const apply = (candidate: StoredRow): StoredRow => {
            const { origin: previous, leaving, ...rest } = candidate;
            const kept = typedOrigin === undefined ? previous : origin;

            return {
                ...rest,
                ...flags,
                ...(kept === undefined ? {} : { origin: kept }),
                ...(leaving === true && change.enabled !== true ? { leaving } : {})
            };
        };

        // Decided on the row as the job finds it, since a change queued before this one may have turned it on.
        const touchesIngress = await this.changing(async () => {
            this.refuseWhileUnlinking();
            await this.settleIfUnsure();

            const row = this.stored.rows.find((candidate) => candidate.id === id);

            if (row === undefined) {
                throw new TunnelConfigError('unknown-row', 'That hostname is not on this tunnel');
            }

            if (retargets && row.kind === 'mcp') {
                throw new TunnelConfigError('mcp-fixed', 'The MCP always points at Ruimte itself');
            }

            const port = change.port ?? row.port;

            if (row.kind === 'dev' && (change.enabled === true || change.port !== undefined)) {
                const reason = port === null ? 'A dev server needs a port' : deniedPortReason(port, this.ports.deniedPorts());

                if (reason !== null) {
                    throw new TunnelConfigError('port-denied', reason);
                }
            }

            const touches = change.enabled !== undefined || (retargets && (change.enabled ?? row.enabled));

            if (touches) {
                this.requireToken();
            }

            const tunnel = this.stored.tunnel;

            // Looked up by name whatever the row says: its record may be refused on add, or gone after a delete whose answer got lost.
            // Its 404 goes first, since an add whose write failed never landed it and a catch-all that serves would answer the record.
            if (change.enabled === true && tunnel !== null) {
                this.refuseUnheld(await this.commit(this.stored.rows), tunnel.name, row.hostname);

                const lookup = { looked: false };

                try {
                    await this.recordRow(this.api(), row, tunnel.id, lookup);
                } catch (e) {
                    // A row already on stays on, held the way a bring-up holds it, so it says why after this job.
                    if (meantOn(row)) {
                        this.holdUnrecorded(row, e, lookup);
                    }

                    throw e;
                }
            }

            const rows = this.stored.rows.map((candidate) => (candidate.id === id ? apply(candidate) : candidate));

            if (!touches) {
                this.stored = { ...this.stored, rows };
                this.save();

                return false;
            }

            // Off is the person's intent before Cloudflare took it; on and a new port wait for Cloudflare, so Try again never
            // publishes a change that failed.
            if (rows.some((candidate) => candidate.id === id && !meantOn(candidate))) {
                this.intend(rows);
            }

            this.refuseUnsettled(await this.commit(rows), tunnel?.name ?? '', row.hostname);

            return true;
        });

        if (touchesIngress) {
            await this.followUp();
        } else {
            this.announce();
        }

        return this.describe();
    }

    /* A record goes out only behind a 404 Cloudflare holds, since another writer's rule could serve the name it points at the tunnel. */
    private refuseUnheld(holds: boolean, tunnelName: string, hostname: string): void {
        if (holds) {
            return;
        }

        const unheld = new TunnelConfigError(
            'hostname-unheld',
            `Another change to ${tunnelName} kept taking away the rule that holds ${hostname}, so Ruimte made no DNS record for it and left it off. Try again, then turn it on.`
        );

        this.noteFailure(unheld, unheld.message);

        throw unheld;
    }

    /* A change resolves only once Cloudflare holds it, so a write another writer kept undoing is said rather than passed over. */
    private refuseUnsettled(holds: boolean, tunnelName: string, hostname: string): void {
        if (holds) {
            return;
        }

        const unsettled = new TunnelConfigError(
            'hostname-unsettled',
            `Another change to ${tunnelName} kept changing the hostnames Ruimte wrote, so ${hostname} may not be as you set it. Try again.`
        );

        this.noteFailure(unsettled, unsettled.message);

        throw unsettled;
    }

    private refuseWhileUnlinking(): void {
        const tunnel = this.stored.tunnel;

        if (tunnel?.leaving === true) {
            throw new TunnelConfigError('unlinking', `Ruimte has not finished unlinking ${tunnel.name}. Try again to finish.`);
        }
    }

    /*
     * Saves what the person asked of the rows. A row that goes off or leaves is saved so before Cloudflare took it, so no
     * later write serves it again; what showed on stays on screen as what Cloudflare may serve until a write held.
     */
    private intend(rows: StoredRow[]): void {
        for (const row of this.stored.rows) {
            const next = rows.find((candidate) => candidate.id === row.id);

            if (meantOn(row) && next !== undefined && !meantOn(next) && !this.serving.has(row.id)) {
                this.serving.set(row.id, {});
            }
        }

        this.stored = { ...this.stored, rows };
        this.save();
    }

    /* Forgets the tunnel and its rows here; nothing in Cloudflare changes. */
    private forget(): void {
        this.runsElsewhere = false;
        this.others = [];
        this.serving.clear();
        this.unrecorded.clear();
        this.reasons.clear();
        this.unsure = false;
        this.stored = { ...this.stored, tunnel: null, rows: [] };
        this.save();
    }

    /* Undefined for a refusal of the token, which cannot reach what it asked for; anything else stays a failure. */
    private unlessRefused(e: unknown): undefined {
        if (e instanceof CloudflareError && (e.code === 'no-permission' || e.code === 'token-refused')) {
            return undefined;
        }

        throw e;
    }

    /* Takes the rule out of Cloudflare, then deletes the DNS record, but only while it is still the one Ruimte made. */
    async remove(id: string): Promise<TunnelState> {
        if (!this.stored.rows.some((row) => row.id === id)) {
            throw new TunnelConfigError('unknown-row', 'That hostname is not on this tunnel');
        }

        await this.changing(async () => {
            const row = this.stored.rows.find((candidate) => candidate.id === id);
            const tunnel = this.stored.tunnel;

            if (row === undefined || tunnel === null) {
                return;
            }

            this.refuseWhileUnlinking();

            const api = this.api();

            await this.settleIfUnsure();
            this.intend(this.stored.rows.map((candidate) => (candidate.id === id ? { ...candidate, enabled: false, leaving: true } : candidate)));
            await this.finishLeaving(api, tunnel.id);
        });
        await this.followUp();

        return this.describe();
    }

    /*
     * Takes every leaving row off: its 404 first, so nothing catches the name while the record stands, then the record,
     * and then the rule. A row is dropped once Cloudflare holds neither; one that is not stays leaving, which its row
     * says, until a Try again finishes it.
     */
    private async finishLeaving(api: CloudflareApi, tunnelId: string): Promise<void> {
        const leaving = this.stored.rows.filter((row) => row.leaving === true);

        if (leaving.length === 0) {
            return;
        }

        await this.commit(this.stored.rows);

        for (const row of leaving) {
            await this.deleteRecordOf(api, row, tunnelId);
        }

        await this.commit(
            this.stored.rows,
            leaving.map((row) => row.id)
        );

        // A write another writer kept undoing may still have dropped a row whose rule the read back found gone.
        const left = this.stored.rows.filter((row) => row.leaving === true);

        if (left.length === 0) {
            return;
        }

        const hostnames = left.map((row) => row.hostname).join(', ');
        const incomplete = new TunnelConfigError(
            'remove-incomplete',
            `Another change to ${this.stored.tunnel?.name ?? 'the tunnel'} kept putting back the rule of ${hostnames}, so Ruimte has not finished removing ${hostnames}. Try again to finish.`
        );

        this.noteFailure(incomplete, incomplete.message);

        throw incomplete;
    }

    /* The external listener on or off. Its own switch, apart from any hostname: it also answers on loopback. */
    async setMcp(enabled: boolean): Promise<TunnelState> {
        await this.jobs.run(async () => {
            this.stored = { ...this.stored, mcp: { ...this.stored.mcp, enabled } };
            this.save();

            if (enabled) {
                await this.ensureListener();
            } else {
                this.listenerFailure = null;
                await this.ports.setListener(false);
            }
        });
        this.binary = await this.ports.installer.locate();

        if (this.stored.tunnel !== null && this.token !== null) {
            this.start('starting', async () => {
                await this.settleIfUnsure();
                await this.commit(this.stored.rows);
                await this.reconcileChild();
            });
        } else {
            this.announce();
        }

        return this.describe();
    }

    async retry(): Promise<TunnelState> {
        this.binary = await this.ports.installer.locate();
        this.failure = null;
        this.installFailed = false;

        if (this.binary === null || this.token === null) {
            await this.ensureListener();
        }

        if (this.binary === null) {
            return this.install();
        }

        if (this.token !== null) {
            this.start('checking', async () => {
                // First, since a token Cloudflare refuses or a network that is down leaves the listener on loopback.
                await this.ensureListener();

                const api = this.api();

                await api.verifyToken();
                this.zones = await api.zones();
                await this.bringUp();
            });

            return this.describe();
        }

        this.announce();

        return this.describe();
    }

    async discover(): Promise<Array<{ port: number; session: string | null }>> {
        const denied = this.ports.deniedPorts();
        const taken = new Set(this.stored.rows.map((row) => row.port));

        return (await this.ports.discover()).filter((entry) => deniedPortReason(entry.port, denied) === null && !taken.has(entry.port));
    }

    /*
     * Boot: a row that does not come back goes off, the listener returns as it was, and the tunnel is brought in line with
     * the rows that are on. Such a row shows on until Cloudflare took it off, since Cloudflare serves it until then.
     */
    async resume(): Promise<void> {
        if (this.stored.rows.some((row) => row.enabled && !row.comeBack)) {
            this.intend(this.stored.rows.map((row) => (row.comeBack ? row : { ...row, enabled: false })));
        }

        // Before Cloudflare is reached, so the listener answers on loopback while the network is down.
        await this.ensureListener();
        this.binary = await this.ports.installer.locate();

        if (this.token !== null) {
            this.start('checking', () => this.refresh());
        }
    }

    /*
     * The network is back, which the daemon learns from the broker taking this machine again. A bring-up that failed
     * because Cloudflare could not be reached tries once more, so the MCP row that comes back on needs no Try again. One
     * still running when the network comes back tries once more after it, if it then fails the same way. The listener
     * the person turned on starts again whatever the token and Cloudflare say, since its port may be free by now.
     */
    networkBack(): void {
        if (this.busy !== null) {
            this.networkReturned = true;

            return;
        }

        if (this.waitsForNetwork && this.token !== null) {
            this.start('checking', () => this.refresh());

            return;
        }

        this.retryListener();
    }

    /* Starts the listener the person turned on once more, behind the job in flight, when it is not listening. */
    private retryListener(): void {
        if (this.stopped || !this.stored.mcp.enabled || this.ports.listenerPort() !== null) {
            return;
        }

        this.pending = this.jobs
            .run(() => this.ensureListener())
            .catch(() => undefined)
            .then(() => this.announce());
    }

    /* The daemon ends its child with it, after the work in flight, and starts nothing from then on. */
    async stop(): Promise<void> {
        this.stopped = true;
        await this.jobs.run(() => this.stopChild());
    }

    private async refresh(): Promise<void> {
        // First, since a network that is still down leaves the listener on loopback.
        await this.ensureListener();
        this.zones = await this.api().zones();
        await this.bringUp();
    }

    /*
     * A tunnel on an account this token does not reach stays as it is, since another token may reach it. Only a token
     * that reaches the account and finds the tunnel gone makes Ruimte forget it and its rows.
     */
    private async checkTunnel(): Promise<void> {
        const tunnel = this.stored.tunnel;

        if (tunnel === null) {
            return;
        }

        if (!this.accounts().some((account) => account.id === tunnel.account.id)) {
            throw new TunnelConfigError(
                'tunnel-unreachable',
                `The tunnel ${tunnel.name} is on the Cloudflare account ${tunnel.account.name}, and this API token does not reach that account. Paste a token that does.`
            );
        }

        const found = await this.api().tunnel(tunnel.account.id, tunnel.id);

        if (found !== null) {
            if (this.child === null) {
                this.runsElsewhere = isRunning(found);
            }

            return;
        }

        await this.stopChild();
        this.forget();

        throw new TunnelConfigError(
            'tunnel-gone',
            `The tunnel ${tunnel.name} is gone from the Cloudflare account ${tunnel.account.name}, so Ruimte forgot it and its hostnames. Their DNS records are still in Cloudflare. Delete them there if you no longer need them.`
        );
    }

    /*
     * Checks the tunnel, writes the hostnames to Cloudflare and starts or stops the child to match. An unlink or Remove
     * that stopped halfway is finished first, and an unlink brings nothing up.
     */
    private async bringUp(): Promise<void> {
        await this.ensureListener();
        await this.checkTunnel();
        await this.settleIfUnsure();

        const tunnel = this.stored.tunnel;

        if (tunnel?.leaving === true) {
            await this.leave();

            return;
        }

        // A Remove that still does not finish holds up no other row; its row says why.
        const unfinished =
            tunnel === null
                ? null
                : await this.finishLeaving(this.api(), tunnel.id).then(
                      () => null,
                      (e: unknown) => e
                  );
        const failed = await this.recordRowsComingBack();

        await this.commit(this.stored.rows);
        await this.reconcileChild();

        if (failed !== null || unfinished !== null) {
            throw failed ?? unfinished;
        }

        const denied = this.stored.rows.find((row) => meantOn(row) && this.portRefusal(row) !== null);

        if (denied !== undefined) {
            throw new TunnelConfigError('port-denied', `${this.portRefusal(denied)}. Ruimte holds ${denied.hostname} off until it points at another port.`);
        }
    }

    /*
     * A row that is on gets its record, looked up by name, since a delete whose answer got lost or the dashboard may have
     * taken it. As on add, a record goes out only behind a 404 Cloudflare holds: a row whose record is missing or not
     * proxied is held first, while the rows whose records stand keep serving, and its record is made only once that
     * write held. One that cannot be made stays meant on and is held with its 404 until a later try; one whose record
     * stood when Ruimte last saw it keeps serving through a lookup that fails. The other rows go on, and a failure is
     * given back to be said once the rest is written, one that may pass first, so the network coming back tries again.
     */
    private async recordRowsComingBack(): Promise<unknown> {
        const tunnel = this.stored.tunnel;
        let failed: unknown = null;

        if (tunnel === null) {
            return failed;
        }

        const fail = (e: unknown): void => {
            if (failed === null || (!passing(failed) && passing(e))) {
                failed = e;
            }
        };

        const api = this.api();
        const due: StoredRow[] = [];

        for (const row of this.stored.rows.filter(meantOn)) {
            try {
                const ours = await this.ourRecordNamed(api, row.zoneId, row.hostname, tunnel.id);

                if (ours?.proxied === true) {
                    this.keepRecord(row.id, ours.id);

                    continue;
                }

                // Saved as gone before anything is written, so a restart whose lookup fails holds the row as well.
                if (ours === undefined) {
                    this.forgetRecord(row.id);
                }

                this.unrecorded.add(row.id);
                this.reasons.set(row.id, noRecordYet(row.hostname));
                due.push(row);
            } catch (e) {
                fail(e);
                this.holdUnrecorded(row, e, { looked: false });
            }
        }

        if (due.length === 0) {
            return failed;
        }

        if (!(await this.commit(this.stored.rows))) {
            const hostnames = due.map((row) => row.hostname).join(', ');

            fail(
                new TunnelConfigError(
                    'hostname-unheld',
                    `Another change to ${tunnel.name} kept taking away the 404 that holds ${hostnames}, so Ruimte has not made the DNS record yet. Try again.`
                )
            );

            return failed;
        }

        for (const row of due) {
            const lookup = { looked: false };

            try {
                await this.recordRow(api, row, tunnel.id, lookup);
            } catch (e) {
                fail(e);
                this.holdUnrecorded(row, e, lookup);
            }
        }

        return failed;
    }

    /*
     * Holds a row meant on whose record could not be made with its 404, and says why. Only a lookup that answered, or a
     * record Ruimte refuses, tells its record is missing, so a row whose record stood keeps serving through the rest.
     */
    private holdUnrecorded(row: StoredRow, e: unknown, lookup: Lookup): void {
        if (row.recordId !== null && !lookup.looked && !(e instanceof TunnelConfigError)) {
            return;
        }

        this.unrecorded.add(row.id);
        this.reasons.set(row.id, this.plain(e, `Making the DNS record of ${row.hostname} did not work`));

        // Its rule may still serve until the 404 lands.
        if (!this.serving.has(row.id)) {
            this.serving.set(row.id, {});
        }
    }

    /* What a request that changed a row leaves to the background: the child starts or stops, and the clients hear of it. */
    private async followUp(): Promise<void> {
        this.binary = await this.ports.installer.locate();
        this.start('starting', () => this.reconcileChild());
    }

    private targetOf(tunnelId: string): string {
        return `${tunnelId}.${TUNNEL_TARGET}`;
    }

    /* Two machines may share a tunnel, so the comment names the machine that made the record. */
    private recordComment(): string {
        return `${RECORD_MARK} · ${machineMarkOf(this.ports.machineId())}`;
    }

    /* A record is Ruimte's only when it is a CNAME to this tunnel that carries the comment of this machine. */
    private isOurs(record: CloudflareRecord, target: string): boolean {
        return record.type === 'CNAME' && record.content === target && record.comment === this.recordComment();
    }

    /* Creates the proxied CNAME to the tunnel, or proxies the one Ruimte made earlier where it is not. `lookup.looked` says the records under the name were read. */
    private async routeHostname(api: CloudflareApi, row: StoredRow, tunnelId: string, lookup: Lookup): Promise<CloudflareRecord> {
        const input = { name: row.hostname, content: this.targetOf(tunnelId), comment: this.recordComment() };
        const ours = await this.ourRecordNamed(api, row.zoneId, row.hostname, tunnelId);

        lookup.looked = true;

        if (ours !== undefined) {
            return ours.proxied === true ? ours : api.updateRecord(row.zoneId, ours.id, input);
        }

        // Saved as gone before the create, so a restart whose lookup fails does not take the old id for a record that stands.
        this.forgetRecord(row.id);

        return api.createRecord(row.zoneId, input);
    }

    private forgetRecord(rowId: string): void {
        if (!this.stored.rows.some((row) => row.id === rowId && row.recordId !== null)) {
            return;
        }

        this.stored = {
            ...this.stored,
            rows: this.stored.rows.map((row) => (row.id === rowId ? { ...row, recordId: null } : row))
        };
        this.save();
    }

    /* The record Ruimte made under the name earlier, if any. Any other record under the name refuses it. */
    private async ourRecordNamed(api: CloudflareApi, zoneId: string, hostname: string, tunnelId: string): Promise<CloudflareRecord | undefined> {
        const target = this.targetOf(tunnelId);
        const existing = await api.recordsNamed(zoneId, hostname);
        const foreign = existing.find((record) => !this.isOurs(record, target));

        if (foreign !== undefined && (foreign.comment ?? '').startsWith(RECORD_MARK)) {
            throw new TunnelConfigError('other-machine', `${hostname} belongs to Ruimte on another computer. Pick another name.`);
        }

        if (foreign !== undefined) {
            throw new TunnelConfigError(
                'foreign-record',
                `${hostname} already has a DNS record of type ${foreign.type}${foreign.content === undefined ? '' : ` pointing at ${foreign.content}`} that Ruimte did not make, so Ruimte leaves it alone. Delete it in Cloudflare or pick another name.`
            );
        }

        return existing[0];
    }

    /*
     * Deletes every record under the name of a row that is still one Ruimte made, whatever id the row kept: a create
     * whose answer got lost may have made one the row never heard of. The row then has no record, so turning it on again
     * before Remove or unlink finished makes one first.
     */
    private async deleteRecordOf(api: CloudflareApi, row: StoredRow, tunnelId: string): Promise<void> {
        const target = this.targetOf(tunnelId);
        const live = (await api.recordsNamed(row.zoneId, row.hostname)).filter((record) => this.isOurs(record, target));

        for (const record of live) {
            await api.deleteRecord(row.zoneId, record.id, row.hostname);
        }

        this.forgetRecord(row.id);
    }

    /*
     * Writes the rows to Cloudflare and saves them once it took them. The rows are the person's intent; what Cloudflare
     * serves after a write that failed, or that another writer undid twice, is only observed (`settle`) and never saved.
     * A failure keeps the screen saying why. The rows of `gone` (ids of leaving rows whose record is deleted) get no rule
     * and are dropped once that held. True once Cloudflare holds the rows as written. `landing` says whether a write went out and, after a failure, which
     * hostnames Cloudflare has a rule of Ruimte's for, or null when it could not be read.
     */
    private async commit(rows: readonly StoredRow[], gone: readonly string[] = [], landing: Landing = { sent: false, ruled: null }): Promise<boolean> {
        let held: boolean;

        try {
            held = await this.syncIngress(rows, gone, landing);
        } catch (e) {
            this.noteFailure(e, 'Saving the hostnames did not work');

            if (landing.sent) {
                landing.ruled = await this.settle(rows, gone).catch(() => null);
            }

            throw e;
        }

        if (!held) {
            await this.settle(rows, gone).catch((e: unknown) => {
                this.noteFailure(e, 'Reading the hostnames back did not work');

                throw e;
            });

            return false;
        }

        this.serving.clear();
        this.unsure = false;

        // A 404 written for a row meant on stays noted, so the row still says why once what held it passed (the listener
        // on, the port free again) and the write that would serve it has not held yet.
        for (const row of rows) {
            if (!meantOn(row)) {
                this.reasons.delete(row.id);
            } else if (this.blocked(row) || (row.kind === 'mcp' && !this.listening())) {
                this.reasons.set(row.id, this.reasons.get(row.id) ?? NOT_SERVED);
            } else {
                this.reasons.delete(row.id);
            }
        }

        this.stored = { ...this.stored, rows: rows.filter((row) => !gone.includes(row.id)) };
        this.save();

        return true;
    }

    private async settleIfUnsure(): Promise<void> {
        if (this.unsure) {
            await this.settle().catch((e: unknown) => {
                this.noteFailure(e, 'Reading the hostnames back did not work');

                throw e;
            });
        }
    }

    /*
     * Reads what Cloudflare serves for each row, the way Cloudflare picks the rule, and keeps that as an observation
     * beside the intent. A row in `gone` whose rule is gone too has left. When Cloudflare cannot be read, a row that
     * `attempted` would have turned on may be served as well, until a later read. Gives the hostnames that have a rule
     * of Ruimte's.
     */
    private async settle(attempted: readonly StoredRow[] = [], gone: readonly string[] = []): Promise<ReadonlySet<string>> {
        const tunnel = this.stored.tunnel;

        if (tunnel === null) {
            return new Set();
        }

        let ingress: readonly CloudflareIngressRule[];

        try {
            ({ ingress } = await this.api().configuration(tunnel.account.id, tunnel.id));
        } catch (e) {
            this.unsure = true;

            for (const row of attempted) {
                if (meantOn(row) && !this.serving.has(row.id)) {
                    this.serving.set(row.id, {});
                }
            }

            throw e;
        }

        const ruled = new Set(
            this.stored.rows.filter((row) => ingress.some((rule) => rule.hostname === row.hostname && rule.path === undefined)).map((row) => row.hostname)
        );
        const left = this.stored.rows.filter((row) => gone.includes(row.id) && !ruled.has(row.hostname));

        this.observe(ingress);

        if (left.length > 0) {
            this.stored = { ...this.stored, rows: this.stored.rows.filter((row) => !left.includes(row)) };
            this.save();
        }

        return ruled;
    }

    /*
     * Notes what Cloudflare serves for each row from an ingress Ruimte read, so the screen shows every read, whatever comes
     * after it, and a row meant on that it does not serve says so.
     */
    private observe(ingress: readonly CloudflareIngressRule[]): void {
        this.serving.clear();

        for (const row of this.stored.rows) {
            const served = servedFor(ingress, row.hostname);

            if (served !== null) {
                this.serving.set(row.id, row.kind === 'mcp' ? {} : served);
            }

            if (served !== null && !this.blocked(row)) {
                this.reasons.delete(row.id);
            } else if (served === null && meantOn(row) && !this.reasons.has(row.id)) {
                this.reasons.set(row.id, NOT_SERVED);
            }
        }

        this.unsure = false;
    }

    private noteFailure(e: unknown, fallback: string): void {
        this.failure = this.plain(e, fallback);
        this.ports.log(`Tunnels: ${this.failure}`);
    }

    /*
     * Points the DNS record of a row at the tunnel, refusing a record Ruimte did not make, and saves its id. A row is
     * turned on only after this, so it never serves on Cloudflare without a record that leads to it.
     */
    private async recordRow(api: CloudflareApi, row: StoredRow, tunnelId: string, lookup: Lookup = { looked: false }): Promise<void> {
        let record: CloudflareRecord;

        try {
            record = await this.routeHostname(api, row, tunnelId, lookup);
        } catch (e) {
            this.noteFailure(e, `Making the DNS record of ${row.hostname} did not work`);

            throw e;
        }

        this.keepRecord(row.id, record.id);
    }

    /* Saves the record a row leads to, which a later write may serve. */
    private keepRecord(rowId: string, recordId: string): void {
        this.unrecorded.delete(rowId);

        // Its rule is still the 404 until a write serves it.
        if (this.reasons.has(rowId)) {
            this.reasons.set(rowId, NOT_SERVED);
        }

        if (!this.stored.rows.some((row) => row.id === rowId && row.recordId !== recordId)) {
            return;
        }

        this.stored = {
            ...this.stored,
            rows: this.stored.rows.map((row) => (row.id === rowId ? { ...row, recordId } : row))
        };
        this.save();
    }

    /* Runs a change of the rows as a job. A failure tells the clients too, since what it saved before failing may differ from what they show. */
    private async changing<T>(work: () => Promise<T>): Promise<T> {
        try {
            return await this.jobs.run(() => this.childInLine(work));
        } catch (e) {
            this.announce();

            throw e;
        }
    }

    /*
     * Runs the work of a job, and then stops the child when no row is meant on or may be served any more, also when the
     * work failed halfway (a Remove that held its 404 and then could not reach the record) or only read what Cloudflare serves.
     */
    private async childInLine<T>(work: () => Promise<T>): Promise<T> {
        try {
            return await work();
        } finally {
            // A child that would not stop was said already, and waiting on it again would hold up every job.
            if (!this.isLive() && this.child !== null && !this.child.stopping) {
                await this.stopChild().catch((e: unknown) => this.noteFailure(e, 'Stopping cloudflared did not work'));
            }
        }
    }

    /*
     * Writes the rows into the tunnel's ingress in Cloudflare as the person meant them. Ruimte owns only the rule without
     * a path for each hostname of a row, on or off; every other rule stays as it was and where it was, and so does a
     * catch-all someone set in the dashboard. Cloudflare takes the first rule that matches, so a rule of Ruimte's goes
     * before the first other rule that could catch its hostname (a wildcard, or a path on any host). A row that is off or
     * leaving always gets a 404 of its own, since its proxied record stays; the rows of `gone` get no rule, their record
     * being deleted already.
     * A write is read back, and written once more when another writer changed a rule of Ruimte's in between or put a rule
     * before a 404 of Ruimte's that serves the name; false when that one did not hold either. `attempt.sent` says
     * whether a write went out, which may have landed on a failure.
     */
    private async syncIngress(rows: readonly StoredRow[], gone: readonly string[], attempt: { sent: boolean }, again = true): Promise<boolean> {
        const tunnel = this.stored.tunnel;

        if (tunnel === null) {
            return true;
        }

        const api = this.api();
        const current = await api.configuration(tunnel.account.id, tunnel.id);

        this.observe(current.ingress);

        const managed = new Set(rows.map((row) => row.hostname));
        const isOurs = (rule: CloudflareIngressRule): boolean => typeof rule.hostname === 'string' && rule.path === undefined && managed.has(rule.hostname);
        const kept = current.ingress.filter((rule) => !isCatchAll(rule) && !isOurs(rule));

        this.others = kept.slice(0, MAX_OTHER_RULES).map(otherRuleOf);
        const catchAll = current.ingress.find((rule) => isCatchAll(rule)) ?? CATCH_ALL;
        // A row held on its own (no record, or a port that became Ruimte's) keeps its 404, so it blocks no other row.
        const serving = ingressRules({
            rows: rows.filter((row) => meantOn(row) && !this.blocked(row)),
            listenerPort: this.stored.mcp.enabled ? this.ports.listenerPort() : null,
            denied: this.ports.deniedPorts()
        });
        const served = new Set(serving.map((rule) => rule.hostname));
        const held = rows.filter((row) => !served.has(row.hostname) && !gone.includes(row.id));

        // A 404 of its own also where the catch-all answers 404, since another writer may make that one serve, and only
        // a rule of Ruimte's is read back.
        const rules: IngressRule[] = [...serving, ...held.map((row) => ({ hostname: row.hostname, ...CATCH_ALL }))];

        // Without a rule of Ruimte's before or after, a tunnel Ruimte did not make gets no write, also when it lacks a catch-all.
        if (!tunnel.created && rules.length === 0 && !current.ingress.some(isOurs)) {
            return true;
        }

        const ingress: CloudflareIngressRule[] = [];
        const holding = new Set(held.map((row) => row.hostname));
        const catches = (rule: CloudflareIngressRule, ours: IngressRule): boolean => mayCatch(rule, ours.hostname, holding.has(ours.hostname));
        let waiting = rules.map((rule) => ({ ...rule }));

        for (const rule of kept) {
            ingress.push(...waiting.filter((ours) => catches(rule, ours)), rule);
            waiting = waiting.filter((ours) => !catches(rule, ours));
        }

        ingress.push(...waiting, { ...catchAll });

        // Nothing to write is no proof a held row serves nothing, so the second round still says when one does.
        if (canonical(ingress) === canonical(current.ingress)) {
            return !held.some((row) => servedFor(current.ingress, row.hostname) !== null);
        }

        attempt.sent = true;
        await api.putConfiguration(tunnel.account.id, tunnel.id, { ingress, rest: current.rest });

        // Cloudflare took the write, so a read back that fails leaves nothing to doubt.
        const after = await api.configuration(tunnel.account.id, tunnel.id).catch(() => null);

        if (after === null) {
            return true;
        }

        // Noted at once, since the second round's read may fail and leave this the last one Ruimte had.
        this.observe(after.ingress);

        // A rule put before one of Ruimte's that serves can also answer its name with a status, which serves it no more.
        const leaks = held.some((row) => servedFor(after.ingress, row.hostname) !== null);
        const starved = serving.some((rule) => servedFor(after.ingress, rule.hostname) === null);
        // A rule put before one of Ruimte's that could catch its name may serve it later, also one that answers 404 now.
        const overtaken = rules.some((ours) => !comesFirst(after.ingress, ours.hostname, holding.has(ours.hostname)));

        if (!leaks && !starved && !overtaken && canonical(after.ingress.filter(isOurs)) === canonical(ingress.filter(isOurs))) {
            return true;
        }

        return again && this.syncIngress(rows, gone, attempt, false);
    }

    /* Whether a row is meant on with its record or Cloudflare may serve it, which is what the child runs for. */
    private isLive(): boolean {
        const listenerPort = this.stored.mcp.enabled ? this.ports.listenerPort() : null;

        return this.stored.rows.some(
            (row) => ((meantOn(row) && !this.blocked(row)) || this.serving.has(row.id)) && (row.kind === 'dev' || listenerPort !== null)
        );
    }

    /*
     * A tunnel that Cloudflare keeps the hostnames of needs no restart for a change: the child runs while any hostname
     * is on. Before it starts one, Ruimte asks Cloudflare whether something already runs the tunnel (a service of the
     * person's, here or on another computer), and then starts nothing; bring-up and Try again look again.
     */
    private async reconcileChild(): Promise<void> {
        const tunnel = this.stored.tunnel;

        if (this.stopped || !this.isLive() || tunnel === null || this.token === null) {
            await this.stopChild();

            return;
        }

        if (this.child !== null) {
            return;
        }

        const found = await this.api().tunnel(tunnel.account.id, tunnel.id);

        this.runsElsewhere = found !== null && isRunning(found);

        if (!this.runsElsewhere && this.binary !== null) {
            await this.startChild(this.binary, tunnel);
        }
    }

    private async startChild(binary: string, tunnel: { id: string; account: TunnelNamed }): Promise<void> {
        const runToken = await this.api().tunnelToken(tunnel.account.id, tunnel.id);

        // The daemon may have stopped while Cloudflare answered; a child started now would outlive it.
        if (this.stopped) {
            return;
        }

        const lines: string[] = [];
        const process = this.ports.runner.start(
            binary,
            ['tunnel', '--no-autoupdate', 'run'],
            (line) => {
                lines.push(this.masked(line, runToken));

                if (lines.length > 20) {
                    lines.shift();
                }
            },
            { TUNNEL_TOKEN: runToken }
        );
        const child = { process, lines, stopping: false };
        this.child = child;

        void process.exited.then((code) => {
            if (this.child !== child) {
                return;
            }

            this.child = null;

            if (!child.stopping) {
                this.failure = sentenceOf(lines, `cloudflared stopped with code ${code}`);
                this.ports.log(`Tunnels: ${this.failure}`);
                this.announce();
            }
        });
    }

    private async stopChild(): Promise<void> {
        const child = this.child;

        if (child === null) {
            return;
        }

        child.stopping = true;
        child.process.stop();

        const waited = await new Promise<boolean>((resolve) => {
            const cancel = cancellableTimeout(this.ports.stopWaitMs ?? STOP_WAIT_MS, () => resolve(false));

            void child.process.exited.then(() => {
                cancel();
                resolve(true);
            });
        });

        // A child that will not end gets a warning and no signal of ours, since another one would only be a guess.
        if (!waited) {
            throw new Error('cloudflared did not stop when asked and is still running. End it yourself, then try again.');
        }

        this.child = null;
    }
}
