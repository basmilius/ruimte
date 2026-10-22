import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { AgentKindSchema, KNOWN_AGENT_KINDS, type AgentKind } from '@ruimte/contracts';
import { isNotFound } from '@adecore/agents';
import { errorText } from '../error-text.ts';
import { BUILT_IN_KINDS } from './kinds.ts';

/* The public ACP registry, the same list the Antigravity server's pin is taken from. */
export const ACP_REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';

// The registry's agents this daemon drives with quirks of its own, under a kind of their own; the catalog leaves them out.
const BUILT_IN_REGISTRY_IDS: ReadonlySet<string> = new Set(['antigravity-acp', 'claude-acp', 'codex-acp', 'github-copilot-cli', 'grok-build']);

// A catalog read within the hour is shown again; a person's refresh asks the registry anyway.
const FRESH_MS = 60 * 60_000;

const FETCH_TIMEOUT_MS = 15_000;

const EnvSchema = z.record(z.string(), z.string());

const BinaryTargetSchema = z.object({
    archive: z.string().url(),
    // The program's path inside the archive, which is what is started.
    cmd: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: EnvSchema.optional(),
    sha256: z
        .string()
        .regex(/^[0-9a-fA-F]{64}$/)
        .optional()
});

// A package reaches npm or uv as an argument, so one that reads as a flag is refused.
const PackageSchema = z.object({ package: z.string().regex(/^[^-\s]\S*$/), args: z.array(z.string()).optional(), env: EnvSchema.optional() });

const AgentSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().optional(),
    website: z.string().optional(),
    repository: z.string().optional(),
    license: z.string().optional(),
    distribution: z.object({
        // By `<os>-<arch>` as the registry names them (`darwin-aarch64`, `linux-x86_64`, `windows-x86_64`).
        binary: z.record(z.string(), BinaryTargetSchema).optional(),
        npx: PackageSchema.optional(),
        uvx: PackageSchema.optional()
    })
});

const RegistrySchema = z.object({ agents: z.array(z.unknown()) });

/* How an agent comes to this machine: an archive (or a bare program) the daemon downloads, or a package npm or uv installs. */
export type RegistryDistribution =
    | { type: 'binary'; url: string; cmd: string; args: string[]; env: Record<string, string>; sha256: string | null }
    | { type: 'npm' | 'uv'; package: string; args: string[]; env: Record<string, string> };

/* One agent of the registry this machine can run, as the catalog and Install read it. */
export interface RegistryEntry {
    id: string;
    kind: AgentKind;
    name: string;
    version: string;
    description: string;
    website?: string;
    repository?: string;
    license?: string;
    distribution: RegistryDistribution;
}

const OS_NAMES: Partial<Record<NodeJS.Platform, string>> = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
const ARCH_NAMES: Partial<Record<string, string>> = { arm64: 'aarch64', x64: 'x86_64' };

/* The registry's name for a system and architecture, null for one it has no name for. */
export function registryPlatform(platform: NodeJS.Platform, arch: string): string | null {
    const os = OS_NAMES[platform];
    const cpu = ARCH_NAMES[arch];
    return os === undefined || cpu === undefined ? null : `${os}-${cpu}`;
}

/*
 * The kind an agent of the registry runs as: its id, when that is a kind at all and names no CLI this daemon or an
 * older one knows by itself (Gemini's id would bring back the kind its old nodes keep).
 */
export function registryKind(id: string): AgentKind | null {
    if (BUILT_IN_REGISTRY_IDS.has(id) || (BUILT_IN_KINDS as readonly string[]).includes(id) || (KNOWN_AGENT_KINDS as readonly string[]).includes(id)) {
        return null;
    }
    return AgentKindSchema.safeParse(id).success ? id : null;
}

/* A build for the platform first, since it needs nothing else on the machine; then an npm package, then a Python one. */
function distributionOf(agent: z.infer<typeof AgentSchema>, platform: string | null): RegistryDistribution | null {
    const target = platform === null ? undefined : agent.distribution.binary?.[platform];
    if (target !== undefined) {
        return {
            type: 'binary',
            url: target.archive,
            cmd: target.cmd,
            args: target.args ?? [],
            env: target.env ?? {},
            sha256: target.sha256?.toLowerCase() ?? null
        };
    }
    const npx = agent.distribution.npx;
    if (npx !== undefined) {
        return { type: 'npm', package: npx.package, args: npx.args ?? [], env: npx.env ?? {} };
    }
    const uvx = agent.distribution.uvx;
    return uvx === undefined ? null : { type: 'uv', package: uvx.package, args: uvx.args ?? [], env: uvx.env ?? {} };
}

/*
 * The agents of a registry document this machine can run, in the registry's order. One that does not read is left out
 * rather than failing the rest, and so is one this daemon offers itself or has no build or package for here.
 */
export function readRegistry(document: unknown, platform: string | null): RegistryEntry[] {
    const parsed = RegistrySchema.safeParse(document);
    if (!parsed.success) {
        throw new Error('The list of agents came back unreadable');
    }
    return parsed.data.agents.flatMap((raw) => {
        const agent = AgentSchema.safeParse(raw);
        if (!agent.success) {
            return [];
        }
        const kind = registryKind(agent.data.id);
        const distribution = distributionOf(agent.data, platform);
        if (kind === null || distribution === null) {
            return [];
        }
        const { id, name, version, description, website, repository, license } = agent.data;
        return [
            {
                id,
                kind,
                name,
                version,
                description: description ?? '',
                ...(website === undefined ? {} : { website }),
                ...(repository === undefined ? {} : { repository }),
                ...(license === undefined ? {} : { license }),
                distribution
            }
        ];
    });
}

/* Reads the registry's document; the default asks the network, a test answers from memory. */
export type RegistryFetch = (url: string) => Promise<unknown>;

const fetchRegistry: RegistryFetch = async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) {
        throw new Error(`The list of agents is unavailable (${response.status})`);
    }
    return await response.json();
};

/* The catalog as one read gave it: from the registry, from the last good copy on disk, or none. */
export interface RegistryRead {
    source: 'live' | 'cached' | 'unavailable';
    fetchedAt: number | null;
    error?: string;
    platform: string | null;
    entries: RegistryEntry[];
}

const CachedSchema = z.object({ fetchedAt: z.number(), document: z.unknown() });

export interface AcpRegistryOptions {
    // `$RUIMTE_HOME`; the last good document is kept in `agent-registry/registry.json`.
    home: string;
    fetch?: RegistryFetch;
    now?: () => number;
    platform?: NodeJS.Platform;
    arch?: string;
}

/*
 * The public ACP registry as this machine last read it. It is read only when a person or an agent asks for the
 * catalog, never on a clock; a read that fails falls back to the last good document on disk and says why.
 */
export class AcpRegistry {
    readonly platform: string | null;
    private readonly path: string;
    private readonly fetch: RegistryFetch;
    private readonly now: () => number;
    private last: RegistryRead | null = null;
    private reading: Promise<RegistryRead> | null = null;

    constructor(options: AcpRegistryOptions) {
        this.path = join(options.home, 'agent-registry', 'registry.json');
        this.fetch = options.fetch ?? fetchRegistry;
        this.now = options.now ?? Date.now;
        this.platform = registryPlatform(options.platform ?? process.platform, options.arch ?? process.arch);
    }

    /* The catalog, read again once the last read is an hour old, or at once with `refresh`; reads at the same time share one. */
    read(refresh = false): Promise<RegistryRead> {
        const last = this.last;
        if (!refresh && last?.source === 'live' && last.fetchedAt !== null && this.now() - last.fetchedAt < FRESH_MS) {
            return Promise.resolve(last);
        }
        this.reading ??= this.readNow().finally(() => {
            this.reading = null;
        });
        return this.reading;
    }

    /* The entry of an id in the catalog as it was last read, without asking the registry. */
    known(id: string): RegistryEntry | undefined {
        return this.last?.entries.find((entry) => entry.id === id);
    }

    private async readNow(): Promise<RegistryRead> {
        try {
            const document = await this.fetch(ACP_REGISTRY_URL);
            const entries = readRegistry(document, this.platform);
            const fetchedAt = this.now();
            this.last = { source: 'live', fetchedAt, platform: this.platform, entries };
            await this.save(fetchedAt, document).catch((e: unknown) => console.warn('Could not keep the ACP registry:', errorText(e)));
            return this.last;
        } catch (e) {
            const error = errorText(e);
            const cached = this.last?.entries.length ? this.last : await this.load();
            this.last =
                cached === null
                    ? { source: 'unavailable', fetchedAt: null, error, platform: this.platform, entries: [] }
                    : { ...cached, source: 'cached', error };
            return this.last;
        }
    }

    private async load(): Promise<RegistryRead | null> {
        try {
            const cached = CachedSchema.parse(JSON.parse(await readFile(this.path, 'utf8')));
            return { source: 'cached', fetchedAt: cached.fetchedAt, platform: this.platform, entries: readRegistry(cached.document, this.platform) };
        } catch (e) {
            if (!isNotFound(e)) {
                console.warn('Could not read the kept ACP registry:', errorText(e));
            }
            return null;
        }
    }

    private async save(fetchedAt: number, document: unknown): Promise<void> {
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        const temporary = `${this.path}.${process.pid}.tmp`;
        await writeFile(temporary, `${JSON.stringify({ fetchedAt, document })}\n`, { mode: 0o600 });
        await rename(temporary, this.path);
    }
}
