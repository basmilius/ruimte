import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { AgentKind, CliInstallMethod, CliVersion, ProviderInfo } from '@ruimte/contracts';
import { runProcess, type ProcessResult } from '@adecore/agents';
import { errorText } from '../error-text.ts';

/* How a CLI's executable came to the machine, read from where it really is. */
interface CliInstall {
    method: CliInstallMethod;
    // The formula, cask or npm package the route knows it by.
    package: string | null;
    version: string | null;
    // Homebrew's prefix, or npm's global prefix, which the update runs through.
    prefix: string | null;
    // The revision Homebrew gives a formula rebuilt at the same version (`_2` in `1.2.3_2`).
    revision?: number;
}

const UNKNOWN: CliInstall = { method: 'unknown', package: null, version: null, prefix: null };

// The package under the last `node_modules` of a path: `@scope/name` or `name`, and the folder it is in.
const NODE_PACKAGE = /^(.*\/node_modules\/((?:@[^/]+\/)?[^/]+))(?:\/|$)/;

function nodePackage(path: string, readText: (path: string) => string | null): { name: string; folder: string; version: string | null } | null {
    const match = NODE_PACKAGE.exec(path);
    if (match === null) {
        return null;
    }
    const folder = match[1]!;
    let version: string | null = null;
    try {
        const manifest = JSON.parse(readText(`${folder}/package.json`) ?? 'null') as { version?: unknown } | null;
        version = typeof manifest?.version === 'string' ? manifest.version : null;
    } catch {
        version = null;
    }
    return { name: match[2]!, folder, version };
}

/*
 * Reads the install route from the real path of an executable. Homebrew comes first, since a formula of an npm package
 * keeps its own `node_modules` inside the Cellar. A shim that is a short script (pnpm writes those) is read for the
 * package path it starts.
 */
export function classifyInstall(real: string, readText: (path: string) => string | null): CliInstall {
    const path = real.replaceAll('\\', '/');
    const cellar = /^(.*)\/Cellar\/([^/]+)\/([^/]+?)(?:_(\d+))?\//.exec(path);
    if (cellar !== null) {
        return { method: 'homebrew', package: cellar[2]!, version: cellar[3]!, prefix: cellar[1]!, revision: Number(cellar[4] ?? 0) };
    }
    const cask = /^(.*)\/Caskroom\/([^/]+)\/([^/]+)\//.exec(path);
    if (cask !== null) {
        return { method: 'homebrew-cask', package: cask[2]!, version: cask[3] === 'latest' ? null : cask[3]!, prefix: cask[1]! };
    }
    const found = nodePackage(path, readText);
    if (found === null) {
        const script = readText(real);
        const target = script === null || script.length > 4096 ? null : /[^\s"'`]*\/node_modules\/[^\s"'`]+/.exec(script.replaceAll('\\', '/'));
        // npm's `.cmd` shim on Windows names the package relative to its own folder.
        const started = target?.[0].replace(/^%~?dp0%?\/?/, `${path.slice(0, path.lastIndexOf('/'))}/`);
        return started === undefined || started === path ? UNKNOWN : classifyInstall(started, readText);
    }
    const base = { package: found.name, version: found.version };
    if (path.includes('/.bun/install/global/')) {
        return { method: 'bun', ...base, prefix: null };
    }
    if (/\/(\.pnpm|pnpm)\//.test(path)) {
        return { method: 'pnpm', ...base, prefix: null };
    }
    // On Windows a prefix holds `node_modules` itself: `%APPDATA%\npm`, or the folder of a system Node.
    const global = /^(.*)\/lib\/node_modules\//.exec(path) ?? /^([A-Za-z]:\/(?:.*\/)?(?:npm|nodejs))\/node_modules\//.exec(path);
    return global === null ? UNKNOWN : { method: 'npm', ...base, prefix: global[1]! };
}

/*
 * -1, 0 or 1 by semver precedence: the numbers part by part, then a release above its own prereleases, whose
 * identifiers compare as numbers where both are numbers and as text otherwise. Build metadata after `+` weighs nothing.
 */
export function compareVersions(left: string, right: string): number {
    const split = (version: string) => {
        const plain = version.replace(/^v/, '').split('+')[0]!;
        const dash = plain.indexOf('-');
        return dash === -1 ? { core: plain.split('.'), pre: [] } : { core: plain.slice(0, dash).split('.'), pre: plain.slice(dash + 1).split('.') };
    };
    const [a, b] = [split(left), split(right)];
    for (let i = 0; i < Math.max(a.core.length, b.core.length); i++) {
        const order = compareIdentifiers(a.core[i] ?? '0', b.core[i] ?? '0');
        if (order !== 0) {
            return order;
        }
    }
    if (a.pre.length === 0 || b.pre.length === 0) {
        return Math.sign(b.pre.length - a.pre.length);
    }
    for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
        const order = compareIdentifiers(a.pre[i]!, b.pre[i]!);
        if (order !== 0) {
            return order;
        }
    }
    return Math.sign(a.pre.length - b.pre.length);
}

// A numeric identifier ranks below one with letters, as semver has it.
function compareIdentifiers(left: string, right: string): number {
    const [numeric, numericRight] = [/^\d+$/.test(left), /^\d+$/.test(right)];
    if (numeric && numericRight) {
        return Math.sign(Number(left) - Number(right));
    }
    if (numeric !== numericRight) {
        return numeric ? -1 : 1;
    }
    return left < right ? -1 : left > right ? 1 : 0;
}

/* What a route answers for the newest version it offers. */
interface Latest {
    latest: string | null;
    // Homebrew says itself whether an install is behind, which also weighs a revision the version does not show.
    outdated?: boolean;
}

/* Runs a package manager; the default spawns it, a test answers from memory. */
export type VersionRun = (command: string[], env: Record<string, string>) => Promise<ProcessResult>;

/* Throws the last lines a failed install or update printed. */
export function throwOnFailure(command: string[], result: ProcessResult): void {
    if (result.exitCode !== 0) {
        const said = (result.stderr.trim() || result.stdout.trim()).split('\n').slice(-6).join('\n');
        throw new Error(`${basename(command[0]!)} ${command[1]} failed (${result.exitCode})${said === '' ? '' : `: ${said}`}`);
    }
}

/* Reads the newest version of an npm package; the default asks the npm registry. */
type NpmLatest = (name: string) => Promise<string>;

const LOOKUP_TIMEOUT_MS = 30_000;
const UPDATE_TIMEOUT_MS = 10 * 60_000;

const runVersionCommand: VersionRun = (command, env) =>
    runProcess(command, { env: { ...process.env, ...env }, timeoutMs: command.includes('info') ? LOOKUP_TIMEOUT_MS : UPDATE_TIMEOUT_MS });

const npmRegistryLatest: NpmLatest = async (name) => {
    const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}/latest`, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    if (!response.ok) {
        throw new Error(`Could not check for updates of ${name}`);
    }
    const body = (await response.json()) as { version?: unknown };
    if (typeof body.version !== 'string') {
        throw new Error(`The npm registry names no version of ${name}`);
    }
    return body.version;
};

// Homebrew answers from what it has, and never updates itself for a question.
const BREW_ENV = { HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ENV_HINTS: '1' };

/* A CLI whose install is Ruimte's own: the Antigravity server, or an agent of the ACP registry. */
export interface OwnInstall {
    version: string | null;
    path: string | null;
    // The version the pin or the registry names, read again with `refresh`.
    latest(refresh: boolean): Promise<string | null>;
    update(): Promise<void>;
}

interface CliVersionsOptions {
    // The CLIs Ruimte drives through an executable on the PATH, by kind.
    executables: Partial<Record<AgentKind, string>>;
    own: (kind: AgentKind) => OwnInstall | null;
    // The kinds of the CLIs Ruimte installed itself, after the executables.
    ownKinds: () => AgentKind[];
    providers: { current(): Promise<ProviderInfo[]>; invalidate(kind: AgentKind): void };
    which?: (command: string) => string | null;
    realpath?: (path: string) => string;
    readText?: (path: string) => string | null;
    exists?: (path: string) => boolean;
    run?: VersionRun;
    npmLatest?: NpmLatest;
    now?: () => number;
}

// A newest version read within the hour is shown again; a person's check asks the route anyway.
const FRESH_MS = 60 * 60_000;

function readSmallText(path: string): string | null {
    try {
        return readFileSync(path, 'utf8');
    } catch {
        return null;
    }
}

/*
 * The version of each CLI Ruimte drives, how it was installed and whether that route offers a newer one. Nothing here
 * starts a CLI: the version is read from where the route put it, or from the probe the provider list already ran with
 * its updater off. A route is asked for its newest version only when someone asks for the versions, and an update runs
 * only on a person's press, through the route it was installed by.
 */
export class CliVersions {
    private readonly options: CliVersionsOptions;
    private readonly which: (command: string) => string | null;
    private readonly realpath: (path: string) => string;
    private readonly readText: (path: string) => string | null;
    private readonly exists: (path: string) => boolean;
    private readonly run: VersionRun;
    private readonly npmLatest: NpmLatest;
    private readonly now: () => number;
    private readonly checked = new Map<AgentKind, { at: number; key: string; latest: Latest; error?: string }>();
    private readonly updating = new Map<AgentKind, Promise<CliVersion>>();
    private readonly failures = new Map<AgentKind, string>();

    constructor(options: CliVersionsOptions) {
        this.options = options;
        this.which = options.which ?? ((command) => Bun.which(command));
        this.realpath = options.realpath ?? realpathSync;
        this.readText = options.readText ?? readSmallText;
        this.exists = options.exists ?? existsSync;
        this.run = options.run ?? runVersionCommand;
        this.npmLatest = options.npmLatest ?? npmRegistryLatest;
        this.now = options.now ?? Date.now;
    }

    kinds(): AgentKind[] {
        return [...(Object.keys(this.options.executables) as AgentKind[]), ...this.options.ownKinds()];
    }

    async list(refresh = false): Promise<CliVersion[]> {
        const providers = await this.options.providers.current();
        return await Promise.all(this.kinds().map((kind) => this.versionOf(kind, providers, refresh)));
    }

    async one(kind: AgentKind, refresh = false): Promise<CliVersion> {
        if (!this.kinds().includes(kind)) {
            throw new Error(`Ruimte does not keep track of how ${kind} was installed`);
        }
        return await this.versionOf(kind, await this.options.providers.current(), refresh);
    }

    /* Updates a CLI through the route it was installed by; a second press while one runs shares its outcome. */
    update(kind: AgentKind): Promise<CliVersion> {
        const running = this.updating.get(kind);
        if (running !== undefined) {
            return running;
        }
        const update = this.updateNow(kind).finally(() => {
            this.updating.delete(kind);
        });
        this.updating.set(kind, update);
        return update;
    }

    private async updateNow(kind: AgentKind): Promise<CliVersion> {
        const before = await this.one(kind, true);
        const revisionBefore = this.revisionOf(kind);
        this.failures.delete(kind);
        if (!before.updatable || before.latest === null) {
            throw new Error(before.error ?? `${kind} has no update to install`);
        }
        try {
            const own = this.options.own(kind);
            if (own !== null) {
                await own.update();
            } else {
                await this.updateThroughRoute(kind, before.latest);
            }
        } catch (e) {
            this.failures.set(kind, errorText(e));
        }
        this.checked.delete(kind);
        this.options.providers.invalidate(kind);
        const after = await this.one(kind, true);
        const grew =
            after.version === null ||
            before.version === null ||
            (compareVersions(after.version, before.version) || Math.sign(this.revisionOf(kind) - revisionBefore)) > 0;
        if (!this.failures.has(kind) && !grew) {
            this.failures.set(kind, `${METHOD_NAMES[before.method]} kept version ${after.version}; its own settings may hold back newer versions`);
        }
        return this.failures.has(kind) ? { ...after, state: 'failed', error: this.failures.get(kind)! } : { ...after, state: 'idle' };
    }

    private async updateThroughRoute(kind: AgentKind, latest: string): Promise<void> {
        const install = this.locate(kind);
        if (install === null || install.package === null) {
            throw new Error(`Ruimte cannot update ${kind}. Update it the way you installed it.`);
        }
        const name = install.package;
        const command = ((): string[] => {
            switch (install.method) {
                case 'homebrew':
                    return [this.brew(install), 'upgrade', name];
                case 'homebrew-cask':
                    return [this.brew(install), 'upgrade', '--cask', name];
                case 'npm': {
                    const npm =
                        install.prefix !== null && this.exists(join(install.prefix, 'bin', 'npm')) ? join(install.prefix, 'bin', 'npm') : this.tool('npm');
                    return [npm, 'install', '-g', ...(install.prefix === null ? [] : ['--prefix', install.prefix]), `${name}@${latest}`];
                }
                case 'pnpm':
                    return [this.tool('pnpm'), 'add', '-g', `${name}@${latest}`];
                case 'bun':
                    return [this.tool('bun', join(homedir(), '.bun', 'bin', 'bun')), 'add', '-g', `${name}@${latest}`];
                default:
                    throw new Error(`Ruimte cannot update ${kind}. Update it the way you installed it.`);
            }
        })();
        throwOnFailure(command, await this.run(command, {}));
    }

    private async versionOf(kind: AgentKind, providers: ProviderInfo[], refresh: boolean): Promise<CliVersion> {
        const state: CliVersion['state'] = this.updating.has(kind) ? 'updating' : this.failures.has(kind) ? 'failed' : 'idle';
        const failure = state === 'failed' ? { error: this.failures.get(kind)! } : {};
        const own = this.options.own(kind);
        if (own !== null) {
            const read = await this.cached(kind, `ruimte:${own.version}`, refresh, async () => ({ latest: await own.latest(refresh) }));
            const updatable = own.version !== null && read.latest.latest !== null && read.latest.latest !== own.version;
            return {
                provider: kind,
                method: 'ruimte',
                package: null,
                path: own.path,
                version: own.version,
                latest: read.latest.latest,
                updatable,
                state,
                ...(read.error === undefined ? failure : { error: read.error, ...failure }),
                checkedAt: read.at
            };
        }
        const install = this.locate(kind);
        const detected = providers.find((provider) => provider.kind === kind);
        const version = install?.version ?? (detected?.installed ? detected.version : null);
        const base = { provider: kind, path: install === null ? null : this.realOf(kind), version, state, ...failure };
        if (install === null || install.method === 'unknown' || install.package === null) {
            return { ...base, method: install?.method ?? 'unknown', package: install?.package ?? null, latest: null, updatable: false, checkedAt: null };
        }
        const read = await this.cached(kind, `${install.method}:${install.package}:${version}`, refresh, () => this.latestOf(install));
        const latest = read.latest.latest;
        const newer = latest !== null && version !== null && compareVersions(latest, version) > 0;
        return {
            ...base,
            method: install.method,
            package: install.package,
            latest,
            updatable: read.latest.outdated ?? newer,
            ...(read.error === undefined ? {} : { error: read.error }),
            checkedAt: read.at
        };
    }

    private async cached(
        kind: AgentKind,
        key: string,
        refresh: boolean,
        look: () => Promise<Latest>
    ): Promise<{ at: number | null; latest: Latest; error?: string }> {
        const known = this.checked.get(kind);
        if (!refresh && known !== undefined && known.key === key && this.now() - known.at < FRESH_MS) {
            return known;
        }
        const at = this.now();
        const entry = await look().then(
            (latest) => ({ at, key, latest }),
            (e: unknown) => ({ at, key, latest: { latest: null }, error: errorText(e) })
        );
        this.checked.set(kind, entry);

        return entry;
    }

    private async latestOf(install: CliInstall): Promise<Latest> {
        const name = install.package!;
        if (install.method === 'homebrew' || install.method === 'homebrew-cask') {
            const cask = install.method === 'homebrew-cask';
            const result = await this.run([this.brew(install), 'info', '--json=v2', cask ? '--cask' : '--formula', name], BREW_ENV);
            if (result.exitCode !== 0) {
                throw new Error(result.stderr.trim() || `brew info failed (${result.exitCode})`);
            }
            return readBrewInfo(result.stdout, cask);
        }
        return { latest: await this.npmLatest(name) };
    }

    private revisionOf(kind: AgentKind): number {
        return this.options.own(kind) === null ? (this.locate(kind)?.revision ?? 0) : 0;
    }

    private locate(kind: AgentKind): CliInstall | null {
        const real = this.realOf(kind);
        return real === null ? null : classifyInstall(real, this.readText);
    }

    private realOf(kind: AgentKind): string | null {
        const executable = this.options.executables[kind];
        const found = executable === undefined ? null : this.which(executable);
        if (found === null) {
            return null;
        }
        try {
            return this.realpath(found);
        } catch {
            return found;
        }
    }

    private brew(install: CliInstall): string {
        const own = install.prefix === null ? null : join(install.prefix, 'bin', 'brew');
        return own !== null && this.exists(own) ? own : this.tool('brew');
    }

    private tool(name: string, fallback?: string): string {
        const found = this.which(name) ?? (fallback !== undefined && this.exists(fallback) ? fallback : null);
        if (found === null) {
            throw new Error(`${name} is not on this machine`);
        }
        return found;
    }
}

const METHOD_NAMES: Record<CliInstallMethod, string> = {
    homebrew: 'Homebrew',
    'homebrew-cask': 'Homebrew',
    npm: 'npm',
    pnpm: 'pnpm',
    bun: 'Bun',
    ruimte: 'Ruimte',
    unknown: 'The installer'
};

/*
 * Reads `brew info --json=v2`. A cask whose version is `latest` names none, so it is never offered an update: there is
 * nothing to compare it with.
 */
export function readBrewInfo(output: string, cask: boolean): Latest {
    const info = JSON.parse(output) as {
        formulae?: { versions?: { stable?: unknown }; outdated?: unknown }[];
        casks?: { version?: unknown; outdated?: unknown }[];
    };
    const entry = cask ? info.casks?.[0] : info.formulae?.[0];
    if (entry === undefined) {
        throw new Error('Homebrew does not know it');
    }
    const raw = cask ? (entry as { version?: unknown }).version : (entry as { versions?: { stable?: unknown } }).versions?.stable;
    const latest = typeof raw === 'string' && raw !== 'latest' ? raw : null;
    return latest === null ? { latest: null, outdated: false } : { latest, ...(typeof entry.outdated === 'boolean' ? { outdated: entry.outdated } : {}) };
}
