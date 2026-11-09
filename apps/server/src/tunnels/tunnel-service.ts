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
    /* The last job failed because Cloudflare could not be reached or asked Ruimte to wait, so the network coming back tries again. */
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
            mcp: { enabled: this.stored.mcp.enabled, port: this.ports.listenerPort() },
            clients: this.ports.clients(),
            suggestedMcpLabel: this.stored.tunnel === null ? null : this.stored.mcp.label
        };
    }

    /* A row on while it is meant on or Cloudflare may serve it, with the port and origin Cloudflare serves where Ruimte read them. */
    private shown(row: StoredRow): TunnelRow {
        const served = this.serving.get(row.id);
        const read = row.kind === 'dev' && served?.port !== undefined ? served : null;
        const origin = read === null ? row.origin : read.origin;

        return {
            id: row.id,
            kind: row.kind,
            hostname: row.hostname,
            port: read?.port ?? row.port,
            enabled: meantOn(row) || served !== undefined,
            comeBack: row.comeBack,
            ...(origin === undefined ? {} : { origin })
        };
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
                    this.waitsForNetwork = e instanceof CloudflareError && (e.code === 'unreachable' || e.code === 'rate-limited');
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
                const again = this.networkReturned && this.waitsForNetwork && this.token !== null;

                this.networkReturned = false;

                if (again) {
                    this.start('checking', () => this.refresh());
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
            await this.commit(this.stored.rows.map((candidate) => (candidate.id === row.id ? { ...candidate, enabled: true } : candidate)));
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
                await this.recordRow(this.api(), row, tunnel.id);
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

            await this.commit(rows);

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
     * and then the rule. A row is dropped once Cloudflare holds neither.
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
    }

    /* The external listener on or off. Its own switch, apart from any hostname: it also answers on loopback. */
    async setMcp(enabled: boolean): Promise<TunnelState> {
        await this.jobs.run(async () => {
            this.stored = { ...this.stored, mcp: { ...this.stored.mcp, enabled } };
            this.save();
            await this.ports.setListener(enabled);
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

        if (this.binary === null) {
            return this.install();
        }

        if (this.token !== null) {
            this.start('checking', async () => {
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

        if (this.stored.mcp.enabled) {
            await this.ports.setListener(true);
        }

        this.binary = await this.ports.installer.locate();

        if (this.token !== null) {
            this.start('checking', () => this.refresh());
        }
    }

    /*
     * The network is back, which the daemon learns from the broker taking this machine again. A bring-up that failed
     * because Cloudflare could not be reached tries once more, so the MCP row that comes back on needs no Try again. One
     * still running when the network comes back tries once more after it, if it then fails the same way.
     */
    networkBack(): void {
        if (this.token === null) {
            return;
        }

        if (this.busy !== null) {
            this.networkReturned = true;

            return;
        }

        if (!this.waitsForNetwork) {
            return;
        }

        this.start('checking', () => this.refresh());
    }

    /* The daemon ends its child with it, after the work in flight, and starts nothing from then on. */
    async stop(): Promise<void> {
        this.stopped = true;
        await this.jobs.run(() => this.stopChild());
    }

    private async refresh(): Promise<void> {
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
        await this.checkTunnel();
        await this.settleIfUnsure();

        const tunnel = this.stored.tunnel;

        if (tunnel?.leaving === true) {
            await this.leave();

            return;
        }

        if (tunnel !== null) {
            await this.finishLeaving(this.api(), tunnel.id);
        }

        const failed = await this.recordRowsComingBack();

        await this.commit(this.stored.rows);
        await this.reconcileChild();

        if (failed !== null) {
            throw failed;
        }
    }

    /*
     * A row that is on gets its record first, looked up by name, since a delete whose answer got lost may have taken it.
     * One whose record could not be made stays meant on and is held with its 404 until a later try makes it; the other
     * rows go on, and the first failure is given back to be said once the rest is written.
     */
    private async recordRowsComingBack(): Promise<unknown> {
        const tunnel = this.stored.tunnel;
        let failed: unknown = null;

        if (tunnel === null) {
            return failed;
        }

        for (const row of this.stored.rows.filter(meantOn)) {
            try {
                await this.recordRow(this.api(), row, tunnel.id);
            } catch (e) {
                failed ??= e;
                this.unrecorded.add(row.id);

                // Its rule may still serve until the 404 lands.
                if (!this.serving.has(row.id)) {
                    this.serving.set(row.id, {});
                }
            }
        }

        return failed;
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

    /* Creates the proxied CNAME to the tunnel, or proxies the one Ruimte made earlier where it is not. */
    private async routeHostname(api: CloudflareApi, zoneId: string, hostname: string, tunnelId: string): Promise<CloudflareRecord> {
        const input = { name: hostname, content: this.targetOf(tunnelId), comment: this.recordComment() };
        const ours = await this.ourRecordNamed(api, zoneId, hostname, tunnelId);

        if (ours === undefined) {
            return api.createRecord(zoneId, input);
        }

        return ours.proxied === true ? ours : api.updateRecord(zoneId, ours.id, input);
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

        this.stored = {
            ...this.stored,
            rows: this.stored.rows.map((candidate) => (candidate.id === row.id ? { ...candidate, recordId: null } : candidate))
        };
        this.save();
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

    /* Notes what Cloudflare serves for each row from an ingress Ruimte read, so the screen shows every read, whatever comes after it. */
    private observe(ingress: readonly CloudflareIngressRule[]): void {
        this.serving.clear();

        for (const row of this.stored.rows) {
            const served = servedFor(ingress, row.hostname);

            if (served !== null) {
                this.serving.set(row.id, row.kind === 'mcp' ? {} : served);
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
    private async recordRow(api: CloudflareApi, row: StoredRow, tunnelId: string): Promise<void> {
        let record: CloudflareRecord;

        try {
            record = await this.routeHostname(api, row.zoneId, row.hostname, tunnelId);
        } catch (e) {
            this.noteFailure(e, `Making the DNS record of ${row.hostname} did not work`);

            throw e;
        }

        this.unrecorded.delete(row.id);
        this.stored = {
            ...this.stored,
            rows: this.stored.rows.map((candidate) => (candidate.id === row.id ? { ...candidate, recordId: record.id } : candidate))
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
        const serving = ingressRules({
            rows: rows.filter((row) => meantOn(row) && !this.unrecorded.has(row.id)),
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

        const leaks = held.some((row) => servedFor(after.ingress, row.hostname) !== null);

        if (!leaks && canonical(after.ingress.filter(isOurs)) === canonical(ingress.filter(isOurs))) {
            return true;
        }

        return again && this.syncIngress(rows, gone, attempt, false);
    }

    /* Whether a row is meant on with its record or Cloudflare may serve it, which is what the child runs for. */
    private isLive(): boolean {
        const listenerPort = this.stored.mcp.enabled ? this.ports.listenerPort() : null;

        return this.stored.rows.some(
            (row) => ((meantOn(row) && !this.unrecorded.has(row.id)) || this.serving.has(row.id)) && (row.kind === 'dev' || listenerPort !== null)
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
