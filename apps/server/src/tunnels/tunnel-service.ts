import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cancellableTimeout, Serializer } from '@adecore/utils/async';
import type { TunnelRow, TunnelRowKind, TunnelStage, TunnelState } from '@ruimte/contracts';
import { errorText } from '../error-text.ts';
import type { JsonFileStore } from '../json-file-store.ts';
import type { CloudflaredInstaller } from './cloudflared-installer.ts';
import type { CloudflaredProcess, CloudflaredRunner } from './cloudflared-runner.ts';
import { configYaml, deniedPortReason, normalizedDomain, normalizedHostname, TunnelConfigError } from './tunnel-config.ts';
import { EMPTY_TUNNELS, tunnelsFolder, type StoredTunnels } from './tunnel-store.ts';

const URL_PATTERN = /https:\/\/\S+/;
const CREATED_PATTERN = /Created tunnel (\S+) with id ([0-9a-f-]{36})/i;
const CREDENTIALS_PATTERN = /credentials written to (.+?\.json)(?=[.\s]|$)/i;
const MAX_MESSAGE = 500;
const STOP_WAIT_MS = 10_000;

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
    /* Where the config file lives. */
    home: string;
    /* Waits for the child to end after a stop; a test resolves it at once. */
    stopWaitMs?: number;
}

type Busy = 'installing' | 'signing-in' | 'starting' | null;

/*
 * Tunnels on this machine: `cloudflared` under the person's own Cloudflare account. The daemon runs the CLI
 * and writes the config it runs with. It opens neither `cert.pem` nor the tunnel's credentials file, stores no
 * API token and calls no Cloudflare API: only `cloudflared` reads its own login.
 */
export class TunnelService {
    private readonly ports: TunnelPorts;
    private readonly jobs = new Serializer();
    private stored: StoredTunnels;
    private busy: Busy = null;
    private failure: string | null = null;
    private installFailed = false;
    private signInUrl: string | null = null;
    private child: { process: CloudflaredProcess; lines: string[]; stopping: boolean } | null = null;
    private binary: string | null = null;
    private pending: Promise<void> = Promise.resolve();

    constructor(ports: TunnelPorts) {
        this.ports = ports;
        this.stored = ports.store.read() ?? EMPTY_TUNNELS;
    }

    private get configPath(): string {
        return join(tunnelsFolder(this.ports.home), 'config.yml');
    }

    /* Resolves once the work a request started has ended. */
    idle(): Promise<void> {
        return this.pending;
    }

    async state(): Promise<TunnelState> {
        this.binary = await this.ports.installer.locate();

        return this.describe();
    }

    private describe(): TunnelState {
        const { stage, message } = this.stageOf();

        return {
            stage,
            message,
            signInUrl: stage === 'signing-in' ? this.signInUrl : null,
            domain: this.stored.domain,
            rows: this.stored.rows,
            mcp: { enabled: this.stored.mcp.enabled, port: this.ports.listenerPort() },
            clients: this.ports.clients(),
            suggestedMcpHostname: this.stored.domain !== null && this.stored.mcp.label !== null ? `${this.stored.mcp.label}.${this.stored.domain}` : null
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

        if (this.busy === 'signing-in') {
            return { stage: 'signing-in', message: null };
        }

        if (!this.stored.signedIn) {
            return { stage: 'signed-out', message: null };
        }

        if (this.stored.tunnel === null) {
            return { stage: 'no-tunnel', message: null };
        }

        return { stage: this.busy === 'starting' ? 'starting' : 'running', message: null };
    }

    private save(): void {
        this.ports.store.write(this.stored);
    }

    private announce(): void {
        this.ports.changed();
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
                    this.failure = e instanceof TunnelConfigError ? e.message : sentenceOf([errorText(e)], 'That did not work');
                    this.ports.log(`Tunnels: ${this.failure}`);
                } finally {
                    this.busy = null;
                    this.announce();
                }
            })
            .catch(() => undefined);
    }

    /* Runs `cloudflared` to its end and hands back its exit code and what it printed. */
    private async exec(args: readonly string[], onLine?: (line: string) => void): Promise<{ code: number; lines: string[] }> {
        if (this.binary === null) {
            throw new Error('cloudflared is not installed');
        }

        const lines: string[] = [];
        const process = this.ports.runner.start(this.binary, args, (line) => {
            lines.push(line);
            onLine?.(line);
        });

        return { code: await process.exited, lines };
    }

    private async mustSucceed(args: readonly string[], fallback: string): Promise<string[]> {
        const { code, lines } = await this.exec(args);

        if (code !== 0) {
            throw new Error(sentenceOf(lines, fallback));
        }

        return lines;
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

    async signIn(): Promise<TunnelState> {
        this.binary = await this.ports.installer.locate();

        if (this.binary === null || this.busy !== null) {
            return this.describe();
        }

        this.signInUrl = null;
        this.start('signing-in', async () => {
            const { code, lines } = await this.exec(['tunnel', 'login'], (line) => {
                const url = URL_PATTERN.exec(line)?.[0];

                if (url !== undefined && this.signInUrl === null) {
                    this.signInUrl = url;
                    this.announce();
                }
            });

            this.signInUrl = null;

            if (code !== 0) {
                throw new Error(sentenceOf(lines, 'Signing in with Cloudflare did not finish'));
            }

            this.stored = { ...this.stored, signedIn: true };
            this.save();
        });

        return this.describe();
    }

    async setup(rawDomain: string): Promise<TunnelState> {
        const domain = normalizedDomain(rawDomain);

        if (!this.stored.signedIn || this.stored.tunnel !== null) {
            throw new TunnelConfigError('wrong-stage', this.stored.tunnel === null ? 'Sign in with Cloudflare first' : 'This machine has a tunnel already');
        }

        this.binary = await this.ports.installer.locate();
        this.start('starting', async () => {
            const name = `ruimte-${this.ports.random(4)}`;
            const lines = await this.mustSucceed(['tunnel', 'create', name], 'Creating the tunnel failed');
            const created = lines.map((line) => CREATED_PATTERN.exec(line)).find((match) => match !== null);
            const file = lines.map((line) => CREDENTIALS_PATTERN.exec(line)).find((match) => match !== null)?.[1];

            if (!created || file === undefined) {
                throw new Error('cloudflared created a tunnel but did not say where it keeps its credentials');
            }

            this.stored = {
                ...this.stored,
                domain,
                tunnel: { id: created[2]!, name: created[1]!, credentialsFile: file },
                mcp: { ...this.stored.mcp, label: `mcp-${this.ports.random(16)}` }
            };
            this.save();
        });

        return this.describe();
    }

    /* Validates the row, then routes its hostname through Cloudflare and puts it in the running config. */
    async add(input: { kind: TunnelRowKind; hostname: string; port?: number; comeBack?: boolean }): Promise<TunnelState> {
        const tunnel = this.stored.tunnel;

        if (tunnel === null) {
            throw new TunnelConfigError('no-tunnel', 'Set up a tunnel first');
        }

        const hostname = normalizedHostname(input.hostname);

        if (this.stored.rows.some((row) => row.hostname === hostname)) {
            throw new TunnelConfigError('hostname-taken', `${hostname} is on this tunnel already`);
        }

        let port: number | null = null;

        if (input.kind === 'mcp') {
            if (this.stored.rows.some((row) => row.kind === 'mcp')) {
                throw new TunnelConfigError('mcp-exists', 'The MCP has a hostname already; remove it first');
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

        const row: TunnelRow = {
            id: this.ports.random(6),
            kind: input.kind,
            hostname,
            port,
            enabled: true,
            // The MCP has a credential on every request and a hosted client cannot turn it on from outside; a dev server has no gate.
            comeBack: input.comeBack ?? input.kind === 'mcp'
        };

        this.binary = await this.ports.installer.locate();
        this.start('starting', async () => {
            await this.mustSucceed(['tunnel', 'route', 'dns', tunnel.id, hostname], 'Routing the hostname through Cloudflare failed');
            this.stored = { ...this.stored, rows: [...this.stored.rows, row] };
            this.save();
            await this.apply();
        });

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

        this.binary = await this.ports.installer.locate();
        this.start('starting', async () => {
            this.stored = {
                ...this.stored,
                rows: this.stored.rows.map((candidate) => (candidate.id === id ? { ...candidate, ...change } : candidate))
            };
            this.save();
            await this.apply();
        });

        return this.describe();
    }

    async remove(id: string): Promise<TunnelState> {
        if (!this.stored.rows.some((row) => row.id === id)) {
            throw new TunnelConfigError('unknown-row', 'That hostname is not on this tunnel');
        }

        this.binary = await this.ports.installer.locate();
        this.start('starting', async () => {
            this.stored = { ...this.stored, rows: this.stored.rows.filter((row) => row.id !== id) };
            this.save();
            await this.apply();
        });

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

        if (this.stored.tunnel !== null && this.binary !== null) {
            this.start('starting', () => this.apply());
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

        if (this.stored.tunnel !== null) {
            this.start('starting', () => this.apply());

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

    /* Boot: a row that does not come back is off, the listener returns as it was, and the child starts for the rows that are on. */
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

        if (this.stored.tunnel !== null && this.binary !== null && this.stored.rows.some((row) => row.enabled)) {
            this.start('starting', () => this.apply());
        }
    }

    /* The daemon ends its child with it. */
    async stop(): Promise<void> {
        await this.stopChild();
    }

    /* Writes the config, has `cloudflared` check it, and restarts the child, so every hostname drops for a moment. */
    private async apply(): Promise<void> {
        const tunnel = this.stored.tunnel;

        if (tunnel === null) {
            return;
        }

        const listenerPort = this.stored.mcp.enabled ? this.ports.listenerPort() : null;
        const yaml = configYaml({
            tunnelId: tunnel.id,
            credentialsFile: tunnel.credentialsFile,
            rows: this.stored.rows,
            listenerPort,
            denied: this.ports.deniedPorts()
        });

        await mkdir(tunnelsFolder(this.ports.home), { recursive: true, mode: 0o700 });

        const next = `${this.configPath}.next`;
        await writeFile(next, yaml, { mode: 0o600 });
        await this.mustSucceed(['tunnel', '--config', next, 'ingress', 'validate'], 'cloudflared did not accept the configuration');
        await rename(next, this.configPath);
        await this.stopChild();

        const live = this.stored.rows.some((row) => row.enabled && (row.kind === 'dev' || listenerPort !== null));

        if (live && this.binary !== null) {
            this.startChild(this.binary);
        }
    }

    private startChild(binary: string): void {
        const lines: string[] = [];
        const process = this.ports.runner.start(binary, ['tunnel', '--no-autoupdate', '--config', this.configPath, 'run'], (line) => {
            lines.push(line);

            if (lines.length > 20) {
                lines.shift();
            }
        });
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
            throw new Error('cloudflared did not stop when asked. It was left running; end it yourself, then try again.');
        }

        this.child = null;
    }
}
