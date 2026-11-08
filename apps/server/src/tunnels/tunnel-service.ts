import { cancellableTimeout, Serializer } from '@adecore/utils/async';
import type { TunnelNamed, TunnelRowKind, TunnelStage, TunnelState } from '@ruimte/contracts';
import { errorText } from '../error-text.ts';
import type { JsonFileStore } from '../json-file-store.ts';
import {
    CloudflareApi,
    CloudflareError,
    type CloudflareFetch,
    type CloudflareIngressRule,
    type CloudflareRecord,
    type CloudflareZone
} from './cloudflare-api.ts';
import type { CloudflareTokenStore } from './cloudflare-token-store.ts';
import type { CloudflaredInstaller } from './cloudflared-installer.ts';
import type { CloudflaredProcess, CloudflaredRunner } from './cloudflared-runner.ts';
import { CATCH_ALL, deniedPortReason, hostnameInZone, ingressRules, isCatchAll, TunnelConfigError, tunnelNameOf } from './tunnel-config.ts';
import { EMPTY_TUNNELS, type StoredRow, type StoredTunnels } from './tunnel-store.ts';

const MAX_MESSAGE = 500;
const STOP_WAIT_MS = 10_000;
const RECORD_COMMENT = 'Managed by Ruimte';
const TUNNEL_TARGET = 'cfargotunnel.com';
const TOKEN_MASK = '[token]';

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

/*
 * Tunnels on this machine: one tunnel on the person's own Cloudflare account, whose hostnames live in Cloudflare
 * (the dashboard shows the same), and a `cloudflared` that runs it. Ruimte reaches Cloudflare only with the API token
 * the person typed, and changes only the tunnel it made and the DNS records it made for it. The token that runs the
 * tunnel is fetched when the child starts and goes to the child's environment, never to a command line or a file.
 */
export class TunnelService {
    private readonly ports: TunnelPorts;
    private readonly jobs = new Serializer();
    private stored: StoredTunnels;
    private token: string | null;
    private zones: CloudflareZone[] = [];
    private busy: Busy = null;
    private failure: string | null = null;
    private installFailed = false;
    private child: { process: CloudflaredProcess; lines: string[]; stopping: boolean } | null = null;
    private binary: string | null = null;
    private pending: Promise<void> = Promise.resolve();

    constructor(ports: TunnelPorts) {
        this.ports = ports;
        this.stored = ports.store.read() ?? EMPTY_TUNNELS;
        this.token = ports.tokens.read();
    }

    /* Resolves once the work a request started has ended. */
    idle(): Promise<void> {
        return this.pending;
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
            tunnel: this.stored.tunnel === null ? null : { name: this.stored.tunnel.name },
            rows: this.stored.rows.map((row) => ({
                id: row.id,
                kind: row.kind,
                hostname: row.hostname,
                port: row.port,
                enabled: row.enabled,
                comeBack: row.comeBack
            })),
            mcp: { enabled: this.stored.mcp.enabled, port: this.ports.listenerPort() },
            clients: this.ports.clients(),
            suggestedMcpLabel: this.stored.tunnel === null ? null : this.stored.mcp.label
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
        this.busy = busy;
        this.failure = null;
        this.announce();
        this.pending = this.jobs
            .run(async () => {
                try {
                    await work();
                } catch (e) {
                    this.failure = this.plain(e, 'That did not work');
                    this.ports.log(`Tunnels: ${this.failure}`);
                } finally {
                    this.busy = null;
                    this.announce();
                }
            })
            .catch(() => undefined);
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

    /* Makes this machine's tunnel on the account, with its hostnames kept in Cloudflare. */
    async setup(accountId?: string): Promise<TunnelState> {
        if (this.token === null || this.stored.tunnel !== null) {
            throw new TunnelConfigError('wrong-stage', this.token === null ? 'Add a Cloudflare API token first' : 'This machine has a tunnel already');
        }

        const accounts = this.accounts();
        const account = accountId === undefined ? (accounts.length === 1 ? accounts[0] : undefined) : accounts.find((candidate) => candidate.id === accountId);

        if (account === undefined) {
            throw new TunnelConfigError('account-required', 'Pick the Cloudflare account that gets the tunnel');
        }

        this.binary = await this.ports.installer.locate();
        this.start('starting', async () => {
            const api = this.api();
            const name = tunnelNameOf(this.ports.machineName(), this.ports.machineId());

            if ((await api.findTunnel(account.id, name)) !== null) {
                throw new TunnelConfigError(
                    'tunnel-exists',
                    `${account.name} has a tunnel named ${name} already, and Ruimte only works with a tunnel it made itself. It may belong to another machine of yours, so check that first. Delete it in the Cloudflare dashboard (Networks, Tunnels) only if no machine uses it, then try again.`
                );
            }

            const created = await api.createTunnel(account.id, name);

            this.stored = {
                ...this.stored,
                tunnel: { id: created.id, name: created.name, account },
                mcp: { ...this.stored.mcp, label: `mcp-${this.ports.random(16)}` }
            };
            this.save();
            await this.syncIngress();
        });

        return this.describe();
    }

    /*
     * Puts a hostname on the tunnel: the DNS record first, then the rule in Cloudflare. A name that has a record Ruimte did
     * not make is refused before anything is written.
     */
    async add(input: { kind: TunnelRowKind; zone: string; label: string; port?: number; comeBack?: boolean }): Promise<TunnelState> {
        await this.jobs.run(async () => {
            const tunnel = this.stored.tunnel;

            if (tunnel === null) {
                throw new TunnelConfigError('no-tunnel', 'Set up a tunnel first');
            }

            const api = this.api();
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

            if (input.kind === 'mcp') {
                if (this.stored.rows.some((row) => row.kind === 'mcp')) {
                    throw new TunnelConfigError('mcp-exists', 'The MCP already has a hostname. Remove that one first');
                }
            } else {
                if (input.port === undefined) {
                    throw new TunnelConfigError('port-required', 'A dev server needs a port');
                }

                const reason = deniedPortReason(input.port, this.ports.deniedPorts());

                if (reason !== null) {
                    throw new TunnelConfigError('port-denied', reason);
                }

                port = input.port;
            }

            const record = await this.routeHostname(api, zone, hostname, tunnel.id);

            this.stored = {
                ...this.stored,
                rows: [
                    ...this.stored.rows,
                    {
                        id: this.ports.random(6),
                        kind: input.kind,
                        hostname,
                        port,
                        enabled: true,
                        // The MCP has a credential on every request and a hosted client cannot turn it on from outside; a dev server has no gate.
                        comeBack: input.comeBack ?? input.kind === 'mcp',
                        zoneId: zone.id,
                        recordId: record.id
                    }
                ]
            };
            this.save();
            await this.syncIngress();
        });
        await this.followUp();

        return this.describe();
    }

    async update(id: string, change: { enabled?: boolean; comeBack?: boolean }): Promise<TunnelState> {
        const row = this.stored.rows.find((candidate) => candidate.id === id);

        if (row === undefined) {
            throw new TunnelConfigError('unknown-row', 'That hostname is not on this tunnel');
        }

        if (change.enabled === true && row.kind === 'dev') {
            const reason = row.port === null ? 'A dev server needs a port' : deniedPortReason(row.port, this.ports.deniedPorts());

            if (reason !== null) {
                throw new TunnelConfigError('port-denied', reason);
            }
        }

        if (change.enabled !== undefined) {
            this.requireToken();
        }

        await this.jobs.run(async () => {
            const rows = this.stored.rows.map((candidate) => (candidate.id === id ? { ...candidate, ...change } : candidate));

            if (change.enabled !== undefined) {
                await this.syncRows(rows);
            }

            this.stored = { ...this.stored, rows };
            this.save();
        });

        if (change.enabled !== undefined) {
            await this.followUp();
        } else {
            this.announce();
        }

        return this.describe();
    }

    /* Takes the rule out of Cloudflare, then deletes the DNS record, but only while it is still the one Ruimte made. */
    async remove(id: string): Promise<TunnelState> {
        if (!this.stored.rows.some((row) => row.id === id)) {
            throw new TunnelConfigError('unknown-row', 'That hostname is not on this tunnel');
        }

        await this.jobs.run(async () => {
            const row = this.stored.rows.find((candidate) => candidate.id === id);
            const tunnel = this.stored.tunnel;

            if (row === undefined || tunnel === null) {
                return;
            }

            const api = this.api();
            const released = this.stored.rows.map((candidate) => (candidate.id === id ? { ...candidate, enabled: false } : candidate));

            await this.syncRows(released);
            this.stored = { ...this.stored, rows: released };
            this.save();

            const target = this.targetOf(tunnel.id);
            const live = (await api.recordsNamed(row.zoneId, row.hostname)).find((record) => record.id === row.recordId);

            if (live !== undefined && this.isOurs(live, target)) {
                await api.deleteRecord(row.zoneId, row.recordId, row.hostname);
            }

            this.stored = { ...this.stored, rows: this.stored.rows.filter((candidate) => candidate.id !== id) };
            this.save();
        });
        await this.followUp();

        return this.describe();
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
                await this.syncIngress();
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

    /* Boot: a row that does not come back is off, the listener returns as it was, and the tunnel is brought in line with the rows that are on. */
    async resume(): Promise<void> {
        this.stored = {
            ...this.stored,
            rows: this.stored.rows.map((row) => (row.comeBack ? row : { ...row, enabled: false }))
        };
        this.save();

        if (this.stored.mcp.enabled) {
            await this.ports.setListener(true);
        }

        this.binary = await this.ports.installer.locate();

        if (this.token !== null) {
            this.start('checking', async () => {
                this.zones = await this.api().zones();
                await this.bringUp();
            });
        }
    }

    /* The daemon ends its child with it. */
    async stop(): Promise<void> {
        await this.stopChild();
    }

    /* A tunnel that is gone from the account, or on an account this token does not reach, is forgotten with its rows, and the person is told. */
    private async checkTunnel(): Promise<void> {
        const tunnel = this.stored.tunnel;

        if (tunnel === null) {
            return;
        }

        const reachable = this.accounts().some((account) => account.id === tunnel.account.id);

        if (reachable && (await this.api().tunnel(tunnel.account.id, tunnel.id)) !== null) {
            return;
        }

        await this.stopChild();
        this.stored = { ...this.stored, tunnel: null, rows: [] };
        this.save();

        throw new TunnelConfigError(
            'tunnel-gone',
            `The tunnel ${tunnel.name} is not on the Cloudflare account this token reaches, so Ruimte forgot it and its hostnames. Their DNS records are still in Cloudflare. Delete them there if you no longer need them.`
        );
    }

    /* Checks the tunnel, writes the hostnames to Cloudflare and starts or stops the child to match. */
    private async bringUp(): Promise<void> {
        await this.checkTunnel();
        await this.syncIngress();
        await this.reconcileChild();
    }

    /* What a request that changed a row leaves to the background: the child starts or stops, and the clients hear of it. */
    private async followUp(): Promise<void> {
        this.binary = await this.ports.installer.locate();
        this.start('starting', () => this.reconcileChild());
    }

    private targetOf(tunnelId: string): string {
        return `${tunnelId}.${TUNNEL_TARGET}`;
    }

    /* A record is Ruimte's only when it is a CNAME to this tunnel that carries Ruimte's comment. */
    private isOurs(record: CloudflareRecord, target: string): boolean {
        return record.type === 'CNAME' && record.content === target && (record.comment ?? '').startsWith(RECORD_COMMENT);
    }

    /* Creates the proxied CNAME to the tunnel, or updates the one Ruimte made earlier. Any other record under the name stops it. */
    private async routeHostname(api: CloudflareApi, zone: CloudflareZone, hostname: string, tunnelId: string): Promise<CloudflareRecord> {
        const target = this.targetOf(tunnelId);
        const existing = await api.recordsNamed(zone.id, hostname);
        const foreign = existing.find((record) => !this.isOurs(record, target));

        if (foreign !== undefined) {
            throw new TunnelConfigError(
                'foreign-record',
                `${hostname} already has a DNS record of type ${foreign.type}${foreign.content === undefined ? '' : ` pointing at ${foreign.content}`} that Ruimte did not make, so Ruimte leaves it alone. Delete it in Cloudflare or pick another name.`
            );
        }

        const input = { name: hostname, content: target, comment: RECORD_COMMENT };
        const ours = existing[0];

        return ours === undefined ? api.createRecord(zone.id, input) : api.updateRecord(zone.id, ours.id, input);
    }

    /*
     * Writes the ingress of rows that are not saved yet, so they are saved only once Cloudflare took them. On a refusal
     * the saved rows stay, the screen says why, and a child with no hostname left to serve stops, since a route that
     * may still be public is the unsafe side.
     */
    private async syncRows(rows: readonly StoredRow[]): Promise<void> {
        try {
            await this.syncIngress(rows);
        } catch (e) {
            this.failure = this.plain(e, 'Saving the hostnames did not work');
            this.ports.log(`Tunnels: ${this.failure}`);

            if (!this.isLive(rows)) {
                await this.stopChild().catch(() => undefined);
            }

            this.announce();

            throw e;
        }
    }

    /*
     * Writes the hostnames of the rows that are on into the tunnel's ingress in Cloudflare. Ruimte owns only the rule
     * without a path for each hostname of a row, on or off; every other rule stays as it was, and so does a catch-all
     * someone set in the dashboard.
     */
    private async syncIngress(rows: readonly StoredRow[] = this.stored.rows): Promise<void> {
        const tunnel = this.stored.tunnel;

        if (tunnel === null) {
            return;
        }

        const api = this.api();
        const current = await api.ingress(tunnel.account.id, tunnel.id);
        const managed = new Set(rows.map((row) => row.hostname));
        const isOurs = (rule: CloudflareIngressRule): boolean => typeof rule.hostname === 'string' && rule.path === undefined && managed.has(rule.hostname);
        const kept = current.filter((rule) => !isCatchAll(rule) && !isOurs(rule));
        const catchAll = current.find((rule) => isCatchAll(rule)) ?? CATCH_ALL;
        const rules = ingressRules({
            rows,
            listenerPort: this.stored.mcp.enabled ? this.ports.listenerPort() : null,
            denied: this.ports.deniedPorts()
        });

        await api.putIngress(tunnel.account.id, tunnel.id, [...kept, ...rules.map((rule) => ({ ...rule })), { ...catchAll }]);
    }

    private isLive(rows: readonly StoredRow[] = this.stored.rows): boolean {
        const listenerPort = this.stored.mcp.enabled ? this.ports.listenerPort() : null;

        return rows.some((row) => row.enabled && (row.kind === 'dev' || listenerPort !== null));
    }

    /* A tunnel that Cloudflare keeps the hostnames of needs no restart for a change: the child runs while any hostname is on. */
    private async reconcileChild(): Promise<void> {
        if (!this.isLive() || this.stored.tunnel === null || this.token === null) {
            await this.stopChild();

            return;
        }

        if (this.child === null && this.binary !== null) {
            await this.startChild(this.binary, this.stored.tunnel);
        }
    }

    private async startChild(binary: string, tunnel: { id: string; account: TunnelNamed }): Promise<void> {
        const runToken = await this.api().tunnelToken(tunnel.account.id, tunnel.id);
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
