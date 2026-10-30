import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { chmod, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, posix } from 'node:path';
import { z } from 'zod';
import type { AgentKind, RegistryAgent, RegistryCatalog } from '@ruimte/contracts';
import { runProcess, SingleFlight, writeAtomic, type ProcessResult } from '@adecore/agents';
import { createAcpProvider, type ChatProvider } from '@adecore/agents/providers';
import { errorText } from '../error-text.ts';
import { extractEntries, extractZipFile, readArchive } from '../language/archive.ts';
import { acpCatalogStore } from './acp-catalog-store.ts';
import { throwOnFailure } from './cli-versions.ts';
import { RUIMTE_ACP_CLIENT, agentDefaultCatalog, agentModel, allowsContextCommand } from './acp-providers.ts';
import type { AcpRegistry, RegistryDistribution, RegistryEntry } from './acp-registry.ts';
import { downloadFile, type FileDownload } from '../artifacts/artifact-fs.ts';
import { downloadChecked } from './acp-server.ts';

const InstalledSchema = z.object({
    id: z.string(),
    kind: z.string(),
    name: z.string(),
    description: z.string(),
    version: z.string(),
    distribution: z.enum(['binary', 'npm', 'uv']),
    // The program, relative to the version's folder.
    command: z.string(),
    args: z.array(z.string()),
    env: z.record(z.string(), z.string()),
    sha256: z.string().nullable()
});

/* An agent a person installed from the registry, as `installed.json` keeps it. */
type InstalledAgent = z.infer<typeof InstalledSchema>;

/* Runs a package manager; the default spawns it, a test answers from memory. */
export type InstallRun = (command: string[], options: { cwd: string; env: Record<string, string | undefined> }) => Promise<ProcessResult>;

const INSTALL_TIMEOUT_MS = 10 * 60_000;

const runInstall: InstallRun = (command, options) =>
    runProcess(command, { ...options, timeoutMs: INSTALL_TIMEOUT_MS, timeoutMessage: `${basename(command[0] ?? '')} did not finish in time` });

/* What a registry agent's provider is told to the registry that offers it. */
interface OfferedProviders {
    add(provider: ChatProvider): void;
    remove(kind: AgentKind): void;
    invalidate(kind: AgentKind): void;
}

interface RegistryAgentsOptions {
    // `$RUIMTE_HOME`; each agent lives in `agent-registry/agents/<id>`, which no client request reaches.
    home: string;
    registry: AcpRegistry;
    providers: OfferedProviders;
    download?: FileDownload;
    run?: InstallRun;
    // Where an executable on the PATH is, null for none.
    which?: (command: string) => string | null;
    platform?: NodeJS.Platform;
}

const INSTALLED_FILE = 'installed.json';

// A version names a folder, so only the characters a folder name takes safely stay.
function folderOf(version: string): string {
    return version.replace(/[^A-Za-z0-9._+-]/g, '_');
}

/* A path inside the agent's folder as the registry writes it (`./goose`), or null for one that would leave it. */
export function relativeCommand(cmd: string): string | null {
    const path = posix.normalize(cmd.replaceAll('\\', '/')).replace(/^(\.\/)+/, '');
    return path === '' || path === '.' || posix.isAbsolute(path) || path.split('/').includes('..') ? null : path;
}

/* The name of an npm or Python package without the version it is pinned to (`@scope/name@1.2.3`, `name==1.2.3`). */
export function packageName(spec: string, type: 'npm' | 'uv'): string {
    if (type === 'npm') {
        const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0);
        return at === -1 ? spec : spec.slice(0, at);
    }
    return spec.split(/[=<>!~@[;\s]/, 1)[0]!;
}

/* The program an npm package names in `bin` that npx would start: its only one, else the one named like the package. */
export function npmBin(name: string, bin: unknown): string | null {
    const unscoped = name.slice(name.lastIndexOf('/') + 1);
    if (typeof bin === 'string') {
        return unscoped;
    }
    if (typeof bin !== 'object' || bin === null) {
        return null;
    }
    const names = Object.keys(bin);
    return names.length === 1 ? names[0]! : names.includes(unscoped) ? unscoped : null;
}

/* How the archive at an address is packed, by its file name. */
function packingOf(url: string): 'zip' | 'tar.gz' | 'tar' | 'bare' {
    const name = new URL(url).pathname.toLowerCase();
    if (name.endsWith('.zip')) {
        return 'zip';
    }
    if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) {
        return 'tar.gz';
    }
    return /\.(tar\.bz2|tbz2?|tar\.xz|txz|tar)$/.test(name) ? 'tar' : 'bare';
}

type Failure = { error: string };

/*
 * The agents of the ACP registry a person installed on this machine. Only a person's Install puts one in place, at the
 * version the registry names: a download is held to the registry's checksum where it gives one before a byte of it is
 * unpacked, a package goes through npm or uv, and `installed.json` is written last, so the daemon never starts what did
 * not finish. Each installed agent is a provider of its own kind on the shared ACP backend, a chat only.
 */
export class RegistryAgents {
    private readonly root: string;
    private readonly home: string;
    private readonly registry: AcpRegistry;
    private readonly providers: OfferedProviders;
    private readonly download: FileDownload;
    private readonly run: InstallRun;
    private readonly which: (command: string) => string | null;
    private readonly platform: NodeJS.Platform;
    private readonly agents = new Map<string, InstalledAgent>();
    private readonly installing = new SingleFlight<RegistryEntry>();
    private readonly failures = new Map<string, Failure>();

    constructor(options: RegistryAgentsOptions) {
        this.home = options.home;
        this.root = join(options.home, 'agent-registry', 'agents');
        this.registry = options.registry;
        this.providers = options.providers;
        this.download = options.download ?? downloadFile;
        this.run = options.run ?? runInstall;
        this.which = options.which ?? ((command) => Bun.which(command));
        this.platform = options.platform ?? process.platform;
    }

    /* Offers every agent installed before this start; one whose record or program is gone is left out. */
    load(): void {
        let ids: string[];
        try {
            ids = readdirSync(this.root);
        } catch {
            return;
        }
        for (const id of ids) {
            const agent = this.read(id);
            if (agent !== null) {
                this.offer(agent);
            }
        }
    }

    installed(): InstalledAgent[] {
        return [...this.agents.values()];
    }

    /* The line that starts an installed agent, absolute. */
    launch(agent: InstalledAgent): string[] {
        return [join(this.folderOf(agent.id), folderOf(agent.version), agent.command), ...agent.args];
    }

    /* The catalog as the registry gives it for this machine, with where each agent stands here. */
    async catalog(refresh = false): Promise<RegistryCatalog> {
        const read = await this.registry.read(refresh);
        const listed = new Set(read.entries.map((entry) => entry.id));
        // An agent the registry dropped since stays in the list while it is installed, so a person can still remove it.
        const dropped = this.installed().filter((agent) => !listed.has(agent.id));
        return {
            source: read.source,
            fetchedAt: read.fetchedAt,
            ...(read.error === undefined ? {} : { error: read.error }),
            platform: read.platform,
            agents: [...read.entries.map((entry) => this.statusOf(entry)), ...dropped.map((agent) => this.statusOf(this.entryOfInstalled(agent)))]
        };
    }

    /* Where one agent stands, by the catalog as it was last read. */
    status(id: string): RegistryAgent | null {
        const agent = this.agents.get(id);
        const entry = this.registry.known(id) ?? (agent === undefined ? null : this.entryOfInstalled(agent));
        return entry === null ? null : this.statusOf(entry);
    }

    /* Puts the version the registry names in place, which is also how an installed agent is updated; a second press while one runs shares its outcome. */
    install(id: string): Promise<RegistryAgent> {
        return this.installing.run(id, () => this.installNow(id)).then((entry) => this.statusOf(entry));
    }

    /* Takes an agent off this machine and stops offering it; a chat of it that runs keeps its process until it ends. */
    async remove(id: string): Promise<RegistryAgent> {
        const agent = this.agents.get(id);
        if (agent === undefined) {
            throw new Error(`${id} is not installed here`);
        }
        const entry = this.registry.known(id) ?? this.entryOfInstalled(agent);
        await rm(join(this.folderOf(id), INSTALLED_FILE), { force: true });
        this.agents.delete(id);
        this.failures.delete(id);
        this.providers.remove(agent.kind);
        await rm(this.folderOf(id), { recursive: true, force: true });
        return this.statusOf(entry);
    }

    private async installNow(id: string): Promise<RegistryEntry> {
        const entry = this.registry.known(id) ?? (await this.registry.read()).entries.find((candidate) => candidate.id === id);
        if (entry === undefined) {
            throw new Error(`${id} is not available for this machine`);
        }
        this.failures.delete(id);
        const folder = this.folderOf(id);
        const target = join(folder, folderOf(entry.version));
        try {
            await mkdir(folder, { recursive: true, mode: 0o700 });
            await rm(target, { recursive: true, force: true });
            const command = await this.put(entry.distribution, entry, target);
            const agent: InstalledAgent = {
                id,
                kind: entry.kind,
                name: entry.name,
                description: entry.description,
                version: entry.version,
                distribution: entry.distribution.type,
                command,
                args: entry.distribution.args,
                env: entry.distribution.env,
                sha256: entry.distribution.type === 'binary' ? entry.distribution.sha256 : null
            };
            await writeAtomic(join(folder, INSTALLED_FILE), `${JSON.stringify(agent, null, 2)}\n`);
            await this.dropOtherVersions(folder, folderOf(entry.version));
            this.offer(agent);
        } catch (e) {
            await rm(target, { recursive: true, force: true }).catch(() => undefined);
            this.failures.set(id, { error: errorText(e) });
        }
        return entry;
    }

    /* Puts the agent's files under the target and answers the program to start, relative to it. */
    private async put(distribution: RegistryDistribution, entry: RegistryEntry, target: string): Promise<string> {
        if (distribution.type === 'binary') {
            return await this.putBinary(distribution, target);
        }
        const tool = distribution.type === 'npm' ? 'npm' : 'uv';
        const executable = this.which(tool);
        if (executable === null) {
            throw new Error(
                tool === 'npm'
                    ? `${entry.name} installs with npm, which comes with Node.js; it is not on this machine`
                    : `${entry.name} installs with uv, the Python package manager; it is not on this machine`
            );
        }
        await mkdir(target, { recursive: true, mode: 0o700 });
        const name = packageName(distribution.package, distribution.type);
        if (distribution.type === 'npm') {
            await this.runOrThrow([executable, 'install', '--prefix', target, '--no-audit', '--no-fund', distribution.package], target);
            const manifest = JSON.parse(await readFile(join(target, 'node_modules', name, 'package.json'), 'utf8')) as { bin?: unknown };
            const bin = npmBin(name, manifest.bin);
            if (bin === null) {
                throw new Error(`${distribution.package} names no program to start`);
            }
            return this.present(target, posix.join('node_modules', '.bin', bin));
        }
        await this.runOrThrow([executable, 'tool', 'install', distribution.package], target, {
            UV_TOOL_DIR: join(target, 'tools'),
            UV_TOOL_BIN_DIR: join(target, 'bin')
        });
        return this.present(target, posix.join('bin', this.platform === 'win32' ? `${name}.exe` : name));
    }

    private async putBinary(distribution: Extract<RegistryDistribution, { type: 'binary' }>, target: string): Promise<string> {
        const command = relativeCommand(distribution.cmd);
        if (command === null) {
            throw new Error(`The registry names a program outside the agent's folder (${distribution.cmd})`);
        }
        const partial = join(dirname(target), `.partial-${randomBytes(6).toString('hex')}`);
        try {
            await mkdir(partial, { recursive: true, mode: 0o700 });
            const archive = join(partial, 'download');
            await downloadChecked(this.download, distribution.url, archive, distribution.sha256);
            const unpacked = join(partial, 'agent');
            await mkdir(unpacked, { recursive: true });
            const packing = packingOf(distribution.url);
            if (packing === 'zip') {
                await extractZipFile(archive, unpacked);
            } else if (packing === 'tar.gz') {
                await extractEntries(readArchive(await readFile(archive), 'tar.gz'), unpacked);
            } else if (packing === 'tar') {
                // Node reads no bzip2 or xz; the system's tar does, and refuses a path that climbs out.
                // Names rather than paths: Git for Windows' tar reads `C:` as a remote host.
                await this.runOrThrow(['tar', '-xf', basename(archive), '-C', basename(unpacked)], partial);
            } else {
                await rename(archive, join(unpacked, command));
            }
            if (!existsSync(join(unpacked, command))) {
                throw new Error(`The download holds no ${command}`);
            }
            await chmod(join(unpacked, command), 0o755);
            await rename(unpacked, target);
            return command;
        } finally {
            await rm(partial, { recursive: true, force: true });
        }
    }

    private present(target: string, command: string): string {
        if (!existsSync(join(target, command))) {
            throw new Error(`The install left no ${command}`);
        }
        return command;
    }

    private async runOrThrow(command: string[], cwd: string, env: Record<string, string> = {}): Promise<void> {
        throwOnFailure(command, await this.run(command, { cwd, env: { ...process.env, ...env } }));
    }

    private async dropOtherVersions(folder: string, keep: string): Promise<void> {
        for (const name of await readdir(folder)) {
            if (name !== keep && name !== INSTALLED_FILE && !name.startsWith('.')) {
                await rm(join(folder, name), { recursive: true, force: true }).catch(() => undefined);
            }
        }
    }

    private offer(agent: InstalledAgent): void {
        this.agents.set(agent.id, agent);
        const [command, ...args] = this.launch(agent);
        this.providers.add(
            createAcpProvider({
                kind: agent.kind,
                name: agent.name,
                command: command!,
                args,
                env: agent.env,
                catalog: agentDefaultCatalog(),
                model: agentModel,
                loginHint: `Sign in to ${agent.name} the way its own documentation says, then start the chat again.`,
                client: RUIMTE_ACP_CLIENT,
                autoAllow: allowsContextCommand,
                catalogStore: acpCatalogStore(this.home, agent.kind),
                // The record says what is installed; starting the agent to ask would run code a person never asked to run.
                detect: (path) => Promise.resolve({ installed: existsSync(path), version: agent.version })
            })
        );
        this.providers.invalidate(agent.kind);
    }

    private statusOf(entry: RegistryEntry): RegistryAgent {
        const installed = this.agents.get(entry.id)?.version ?? null;
        const failure = this.failures.get(entry.id);
        const state = this.installing.has(entry.id) ? 'installing' : failure !== undefined ? 'failed' : installed === null ? 'missing' : 'installed';
        return {
            id: entry.id,
            kind: entry.kind,
            name: entry.name,
            version: entry.version,
            description: entry.description,
            ...(entry.website === undefined ? {} : { website: entry.website }),
            ...(entry.repository === undefined ? {} : { repository: entry.repository }),
            ...(entry.license === undefined ? {} : { license: entry.license }),
            distribution: entry.distribution.type,
            checksum: entry.distribution.type === 'binary' && entry.distribution.sha256 !== null,
            installed,
            state,
            ...(state === 'failed' ? { error: failure!.error } : {})
        };
    }

    /* An installed agent as a catalog entry, for one the registry no longer lists or has not been read for. */
    private entryOfInstalled(agent: InstalledAgent): RegistryEntry {
        const distribution: RegistryDistribution =
            agent.distribution === 'binary'
                ? { type: 'binary', url: 'file:///', cmd: agent.command, args: agent.args, env: agent.env, sha256: agent.sha256 }
                : { type: agent.distribution, package: agent.id, args: agent.args, env: agent.env };
        return { id: agent.id, kind: agent.kind, name: agent.name, version: agent.version, description: agent.description, distribution };
    }

    private folderOf(id: string): string {
        return join(this.root, id);
    }

    private read(id: string): InstalledAgent | null {
        try {
            const agent = InstalledSchema.parse(JSON.parse(readFileSync(join(this.folderOf(id), INSTALLED_FILE), 'utf8')));
            return agent.id === id && existsSync(join(this.folderOf(id), folderOf(agent.version), agent.command)) ? agent : null;
        } catch {
            return null;
        }
    }
}
