import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import type { LanguageServerKind } from '@ruimte/contracts';
import { LanguageServerKindSchema } from '@ruimte/contracts';
import { errorText } from '../error-text.ts';
import { LanguageLog } from './log.ts';
import {
    cargoCommand,
    download,
    fetchStubs,
    installRelease,
    isNativeKind,
    nativeHasStubs,
    nativeProgramFile,
    nativeProgramOf,
    nativeStorageOf,
    nativeStubsOf,
    nativeTitleOf,
    NativePolicy,
    stubsComplete,
    type Download,
    type NativeKind,
    type NativePlan
} from './native.ts';
import { KIND_PROFILES } from './profiles.ts';
import { runCommand, type LanguageRuntime, type RunCommand } from './runtime.ts';
import { pinnedVersionsOf, versionOf, type NpmKind } from './versions.ts';

const MARKER = 'installed.json';
const SELECTION = 'current.json';
const VERSIONS = 'versions';
/* The install from before installs had a folder each: the packages, the program and the marker in the kind's own folder. */
const LEGACY = 'legacy';
/* What a legacy install left in the kind's folder, beside the storage that every install shares. */
const LEGACY_ENTRIES = [MARKER, 'package.json', 'bun.lock', 'bun.lockb', 'node_modules', 'bin'];
/* A checkout builds into itself, so it has one install that a build replaces. */
const DEV = 'dev';

/* What an install of a native kind says when this build has neither a checkout nor a pinned release of it. */
export const NO_RELEASE = 'No release of this server is available yet';

export type InstallState = 'installed' | 'installing' | 'missing';

/* A checkout's commit and a hash of what was changed in it, or null when it cannot be read. */
export type CheckoutRevision = (folder: string) => Promise<string | null>;

export interface LanguageInstallerOptions {
    /* `$RUIMTE_HOME/language-servers`. */
    root: string;
    runtime: LanguageRuntime;
    run?: RunCommand;
    now?: () => number;
    /* Where the native kinds come from; none by default, so a daemon with no checkout and no release has nothing to install. */
    native?: NativePolicy;
    download?: Download;
    /* A kind changed state: an install began or ended. */
    onChange: (kind: LanguageServerKind) => void;
    /* A kind runs another install now: an update, a rebuild or a step back, so what runs it has to start again. */
    onSwitched?: (kind: LanguageServerKind) => void;
    checkoutRevision?: CheckoutRevision;
}

async function exists(path: string): Promise<boolean> {
    return access(path).then(
        () => true,
        () => false
    );
}

interface Marker {
    versions?: Record<string, string>;
    /* Native kinds: whether a checkout built the server or a release supplied it, and the stubs installed beside it, for a kind that reads them. */
    source?: string;
    stubs?: string;
    /* What a person reads as the version of the install; a legacy marker has none. */
    version?: string;
    /* Native kinds: the file the install runs. */
    executable?: string;
    /* A checkout: the revision it was built at (`CheckoutRevision`). */
    revision?: string;
    installedAt?: number;
}

/* `current.json`: the install a kind runs, and the one before it a person can go back to. */
interface Selection {
    current: string;
    previous?: string;
}

/* One install of a kind: which it is, the folder it is in and what its marker says. */
interface Install {
    id: string;
    directory: string;
    marker: Marker;
}

interface Installs {
    current: Install | null;
    previous: Install | null;
}

/* What a newer pin or a changed checkout offers over the install a kind runs. */
export interface InstallUpdate {
    version: string;
    /* A checkout that changed since its build, which a build brings in. */
    rebuild?: true;
}

/* The commit of a checkout, and a hash of `git status` when something in it was changed, read with git and never changing it. */
export const gitRevision: CheckoutRevision = async (folder) => {
    const output = async (args: string[]): Promise<string | null> => {
        try {
            const child = Bun.spawn(['git', '-C', folder, ...args], { stdout: 'pipe', stderr: 'ignore' });
            const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
            return code === 0 ? text : null;
        } catch {
            return null;
        }
    };
    const [head, status] = await Promise.all([output(['rev-parse', 'HEAD']), output(['status', '--porcelain'])]);
    if (head === null || status === null) {
        return null;
    }
    const changed = status.trim() === '' ? '' : `+${createHash('sha256').update(status).digest('hex').slice(0, 12)}`;
    return `${head.trim()}${changed}`;
};

/*
 * Puts the pinned servers of a kind under `$RUIMTE_HOME/language-servers/<kind>`, with the daemon's own
 * runtime acting as `bun install`, and never on its own: `install` and `rollback` are called for a person's
 * request only. Scripts of the packages do not run. Each install has a folder of its own under `versions`,
 * and `current.json` names the one the kind runs and the one before it, so a pin that moved with an update of
 * Ruimte leaves the kind running what it has, offers the newer one, and installs it beside the old one before
 * it switches. One previous install stays for a step back; anything older goes at the next switch. A server
 * that is a program of its own has to print its version before its marker is written. A native kind
 * (`native.ts`) is not packages: a checkout builds its server with cargo, a release is downloaded and checked
 * against its pinned SHA-256, and either way the standard library stubs come with it, kept beside every install.
 */
export class LanguageInstaller {
    private readonly options: LanguageInstallerOptions;
    private readonly run: RunCommand;
    private readonly installing = new Map<LanguageServerKind, Promise<void>>();
    private readonly failures = new Map<LanguageServerKind, string>();
    private readonly logs = new Map<LanguageServerKind, LanguageLog>();
    private readonly native: NativePolicy;
    /* What each kind has installed, as last read, for the answers that cannot wait for the disk. */
    private readonly known = new Map<LanguageServerKind, Installs>();
    /* The revision of the checkout a native kind builds from, as last read. */
    private readonly revisions = new Map<NativeKind, string | null>();

    constructor(options: LanguageInstallerOptions) {
        this.options = options;
        this.run = options.run ?? runCommand;
        this.native = options.native ?? new NativePolicy({ checkouts: {} });
    }

    /* Reads what every kind has installed. */
    async load(): Promise<void> {
        await Promise.all(LanguageServerKindSchema.options.map((kind) => this.refresh(kind)));
    }

    /* The version a kind runs, or for one not installed the version an install brings; empty for a native kind this build cannot install. */
    versionOf(kind: LanguageServerKind): string {
        const current = this.known.get(kind)?.current;
        return current ? (current.marker.version ?? this.legacyVersionOf(kind, current.marker)) : this.pinnedVersionOf(kind);
    }

    /* The version an install brings now. */
    pinnedVersionOf(kind: LanguageServerKind): string {
        return isNativeKind(kind) ? (this.planOf(kind, this.directoryOf(kind))?.version ?? '') : versionOf(kind);
    }

    /* A native kind this build has no way to install: no checkout to build from and no release pinned. */
    isUnavailable(kind: LanguageServerKind): boolean {
        return isNativeKind(kind) && this.planOf(kind, this.directoryOf(kind)) === null;
    }

    /* What a native kind runs: the program of the install in use and the stubs beside it. Null for any other kind and for one not installed. */
    launchOf(kind: LanguageServerKind): { executable: string; stubsCommit?: string } | null {
        if (!isNativeKind(kind)) {
            return null;
        }
        const current = this.known.get(kind)?.current;
        const executable = current ? this.executableOf(kind, current) : null;
        if (!current || executable === null) {
            return null;
        }
        const stubs = current.marker.stubs;
        if (!nativeHasStubs(kind)) {
            return { executable };
        }
        return stubs === undefined ? null : { executable, stubsCommit: stubs };
    }

    /* `$RUIMTE_HOME/language-servers/<kind>`, which holds the installs, the selection and what every install shares. */
    directoryOf(kind: LanguageServerKind): string {
        return join(this.options.root, kind);
    }

    /* The folder the kind runs from: its install's for the packages of an npm kind, its own for a native kind, whose storage every install shares. */
    installDirectoryOf(kind: LanguageServerKind): string {
        if (isNativeKind(kind)) {
            return this.directoryOf(kind);
        }
        return this.known.get(kind)?.current?.directory ?? this.directoryOf(kind);
    }

    /* What an install would bring over the one the kind runs: a newer pin, or a checkout that changed. Null when it runs what it would get, or runs nothing. */
    updateOf(kind: LanguageServerKind): InstallUpdate | null {
        const current = this.known.get(kind)?.current;
        if (!current) {
            return null;
        }
        if (!isNativeKind(kind)) {
            return this.matchesPins(kind, current.marker) ? null : { version: versionOf(kind) };
        }
        const plan = this.planOf(kind, this.directoryOf(kind));
        if (plan === null) {
            return null;
        }
        const rebuild = plan.source === 'dev' ? ({ rebuild: true } as const) : {};
        if (!this.matchesPins(kind, current.marker)) {
            return { version: plan.version, ...rebuild };
        }
        const revision = this.revisions.get(kind);
        return plan.source === 'dev' && revision != null && current.marker.revision !== revision ? { version: plan.version, rebuild: true } : null;
    }

    /* The version a step back goes to, or null when there is none. */
    previousOf(kind: LanguageServerKind): string | null {
        const previous = this.known.get(kind)?.previous;
        return previous ? (previous.marker.version ?? this.legacyVersionOf(kind, previous.marker)) : null;
    }

    /* Reads again the revision of every checkout a native kind builds from, which a change in the checkout moves. */
    async refreshCheckouts(): Promise<void> {
        for (const kind of LanguageServerKindSchema.options.filter(isNativeKind)) {
            const plan = this.planOf(kind, this.directoryOf(kind));
            if (plan?.source === 'dev' && plan.checkout !== undefined) {
                this.revisions.set(kind, await (this.options.checkoutRevision ?? gitRevision)(plan.checkout));
            }
        }
    }

    logOf(kind: LanguageServerKind): LanguageLog {
        let log = this.logs.get(kind);
        if (!log) {
            log = new LanguageLog(this.options.now);
            this.logs.set(kind, log);
        }
        return log;
    }

    /* Why the last install of the kind failed, until the next one starts. */
    failureOf(kind: LanguageServerKind): string | null {
        return this.failures.get(kind) ?? null;
    }

    async state(kind: LanguageServerKind): Promise<InstallState> {
        if (this.installing.has(kind)) {
            return 'installing';
        }
        return (await this.isInstalled(kind)) ? 'installed' : 'missing';
    }

    /* Whether the install the kind runs is whole, whichever version it is. */
    async isInstalled(kind: LanguageServerKind): Promise<boolean> {
        const { current } = await this.refresh(kind, false);
        return current !== null && (await this.isWhole(kind, current));
    }

    /* Starts the install, or joins the one that runs. The answer settles when it ends; a failure is `failureOf` and the log, never a throw. */
    install(kind: LanguageServerKind): Promise<void> {
        const running = this.installing.get(kind);
        if (running) {
            return running;
        }
        const work = this.perform(kind).finally(() => {
            this.installing.delete(kind);
            this.options.onChange(kind);
        });
        this.installing.set(kind, work);
        this.options.onChange(kind);
        return work;
    }

    /* Goes back to the install before the one in use, which becomes the one to go back to in turn. */
    async rollback(kind: LanguageServerKind): Promise<void> {
        if (this.installing.has(kind)) {
            throw new Error('An install of this server is running');
        }
        const selection = await this.readSelection(kind);
        const { previous } = await this.refresh(kind);
        if (selection === null || selection.previous === undefined || previous === null || !(await this.isWhole(kind, previous))) {
            throw new Error('There is no earlier version of this server to go back to');
        }
        await this.select(kind, { current: selection.previous, previous: selection.current });
        this.logOf(kind).push('install', `Went back to ${this.versionOf(kind)} from ${this.previousOf(kind) ?? ''}`);
        this.options.onSwitched?.(kind);
    }

    private planOf(kind: NativeKind, directory: string): NativePlan | null {
        return this.native.plan(kind, directory);
    }

    /* The folder of an install, which for the legacy one is the kind's own. */
    private folderOf(kind: LanguageServerKind, id: string): string {
        return id === LEGACY ? this.directoryOf(kind) : join(this.directoryOf(kind), VERSIONS, id);
    }

    /* The id an install of the pins takes: a hash of the packages, the version of a release, or the one install of a checkout. */
    private pinnedIdOf(kind: LanguageServerKind): string | null {
        if (isNativeKind(kind)) {
            const plan = this.planOf(kind, this.directoryOf(kind));
            return plan === null ? null : plan.source === 'dev' ? DEV : plan.version;
        }
        const pins = Object.entries(pinnedVersionsOf(kind)).sort(([left], [right]) => left.localeCompare(right));
        return `${versionOf(kind)}-${createHash('sha256').update(JSON.stringify(pins)).digest('hex').slice(0, 8)}`;
    }

    private async readSelection(kind: LanguageServerKind): Promise<Selection | null> {
        try {
            const selection = JSON.parse(await readFile(join(this.directoryOf(kind), SELECTION), 'utf8')) as Selection;
            return typeof selection.current === 'string' ? selection : null;
        } catch {
            return (await this.readMarker(this.directoryOf(kind))) === null ? null : { current: LEGACY };
        }
    }

    private async readMarker(folder: string): Promise<Marker | null> {
        try {
            const marker = JSON.parse(await readFile(join(folder, MARKER), 'utf8')) as Marker;
            return { ...marker, versions: marker.versions ?? {} };
        } catch {
            return null;
        }
    }

    private async readInstall(kind: LanguageServerKind, id: string | undefined): Promise<Install | null> {
        if (id === undefined) {
            return null;
        }
        const directory = this.folderOf(kind, id);
        const marker = await this.readMarker(directory);
        return marker === null ? null : { id, directory, marker };
    }

    /* Reads what a kind has installed; the install before the one in use only changes with a switch, so a start asks for the current one alone. */
    private async refresh(kind: LanguageServerKind, withPrevious = true): Promise<Installs> {
        const selection = await this.readSelection(kind);
        const current = await this.readInstall(kind, selection?.current);
        const previous = withPrevious ? await this.readInstall(kind, selection?.previous) : (this.known.get(kind)?.previous ?? null);
        const installs = { current, previous: selection?.previous === undefined ? null : previous };
        this.known.set(kind, installs);
        return installs;
    }

    /* A legacy marker names its packages and not a version to read; the main package is that version. */
    private legacyVersionOf(kind: LanguageServerKind, marker: Marker): string {
        if (isNativeKind(kind)) {
            return marker.versions?.[nativeProgramOf(kind)] ?? '';
        }
        const main = Object.keys(pinnedVersionsOf(kind))[0];
        return (main === undefined ? undefined : marker.versions?.[main]) ?? '';
    }

    /* The program a native install runs: the one its marker names, or for a legacy install the one it left in the kind's folder or the checkout's. */
    private executableOf(kind: NativeKind, install: Install): string | null {
        if (install.marker.executable !== undefined) {
            return install.marker.executable;
        }
        const plan = this.planOf(kind, install.directory);
        if (install.marker.source === 'dev') {
            return plan?.source === 'dev' ? plan.executable : null;
        }
        return join(install.directory, 'bin', nativeProgramFile(kind, process.platform));
    }

    private matchesPins(kind: LanguageServerKind, marker: Marker): boolean {
        if (isNativeKind(kind)) {
            const plan = this.planOf(kind, this.directoryOf(kind));
            return (
                plan !== null && marker.versions?.[nativeProgramOf(kind)] === plan.version && marker.source === plan.source && marker.stubs === plan.stubsCommit
            );
        }
        return Object.entries(pinnedVersionsOf(kind)).every(([name, version]) => marker.versions?.[name] === version);
    }

    private async isWhole(kind: LanguageServerKind, install: Install): Promise<boolean> {
        if (isNativeKind(kind)) {
            const executable = this.executableOf(kind, install);
            if (executable === null || !(await exists(executable))) {
                return false;
            }
            if (!nativeHasStubs(kind)) {
                return true;
            }
            const stubs = install.marker.stubs;
            return stubs !== undefined && (await stubsComplete(nativeStubsOf(this.directoryOf(kind), stubs)));
        }
        const entries = KIND_PROFILES[kind].components.map((component) => join(install.directory, 'node_modules', component.entry));
        return (await Promise.all(entries.map(exists))).every(Boolean);
    }

    /* A server that is a program of its own has to run on this machine and be the version pinned, since an install of another platform or a bad download leaves a file that only looks right. */
    private async verifyPrograms(kind: NpmKind, directory: string, log: LanguageLog): Promise<void> {
        for (const component of KIND_PROFILES[kind].components.filter((candidate) => candidate.native)) {
            const lines: string[] = [];
            const code = await this.run({ command: join(directory, 'node_modules', component.entry), args: ['--version'], cwd: directory, env: {} }, (line) => {
                lines.push(line);
                log.push('install', line);
            });
            if (code !== 0 || !lines.some((line) => line.includes(versionOf(kind)))) {
                throw new Error(`The ${component.name} server did not report version ${versionOf(kind)}`);
            }
        }
    }

    private async perform(kind: LanguageServerKind): Promise<void> {
        const log = this.logOf(kind);
        this.failures.delete(kind);
        try {
            if ((await this.isInstalled(kind)) && this.updateOf(kind) === null) {
                return;
            }
            const id = this.pinnedIdOf(kind);
            if (id === null) {
                throw new Error(NO_RELEASE);
            }
            const target = this.folderOf(kind, id);
            const there = id === DEV ? null : await this.readInstall(kind, id);
            // The version a person went back from is still whole beside the one in use, so going forward again takes it as it is.
            if (there !== null && this.matchesPins(kind, there.marker) && (await this.isWhole(kind, there))) {
                await this.switchTo(kind, id);
                log.push('install', `Using ${there.marker.version ?? id} again`);
                this.options.onSwitched?.(kind);
                return;
            }
            if (id !== DEV) {
                // A folder an earlier attempt left half done is started over; the install the kind runs is never this one.
                await rm(target, { recursive: true, force: true });
            }
            await mkdir(target, { recursive: true });
            if (isNativeKind(kind)) {
                await this.performNative(kind, target, log);
            } else {
                await this.performPackages(kind, target, log);
            }
            await this.switchTo(kind, id);
            log.push('install', 'Installed');
            this.options.onSwitched?.(kind);
        } catch (error) {
            const message = errorText(error);
            this.failures.set(kind, message);
            log.push('install', `Failed: ${message}`);
        }
    }

    private async performPackages(kind: NpmKind, target: string, log: LanguageLog): Promise<void> {
        const dependencies = pinnedVersionsOf(kind);
        await writeFile(join(target, 'package.json'), `${JSON.stringify({ name: `ruimte-language-server-${kind}`, private: true, dependencies }, null, 2)}\n`);
        log.push(
            'install',
            `Installing ${Object.entries(dependencies)
                .map(([name, version]) => `${name}@${version}`)
                .join(', ')}`
        );
        const { runtime } = this.options;
        const code = await this.run(
            { command: runtime.command, args: [...runtime.args, 'install', '--ignore-scripts'], cwd: target, env: runtime.env },
            (line) => log.push('install', line)
        );
        if (code !== 0) {
            throw new Error(`The installer exited with code ${code}`);
        }
        for (const component of KIND_PROFILES[kind].components) {
            const entry = join(target, 'node_modules', component.entry);
            if (!(await exists(entry))) {
                throw new Error(`The install did not leave ${entry}`);
            }
        }
        await this.verifyPrograms(kind, target, log);
        await this.writeMarker(target, { versions: dependencies, version: versionOf(kind) });
    }

    private async performNative(kind: NativeKind, target: string, log: LanguageLog): Promise<void> {
        const plan = this.planOf(kind, target);
        if (plan === null) {
            throw new Error(NO_RELEASE);
        }
        const push = (line: string): void => log.push('install', line);
        if (plan.source === 'dev') {
            push(`Building ${plan.version} from ${plan.checkout}`);
            await this.build(kind, plan, push);
        } else {
            if (plan.asset === undefined) {
                throw new Error(`This release has no build for ${process.platform}-${process.arch}`);
            }
            await installRelease(plan.asset, target, this.options.download ?? download, push);
        }
        if (!(await exists(plan.executable))) {
            throw new Error(`The install did not leave ${plan.executable}`);
        }
        await this.verifyNative(plan, push);
        if (plan.stubsCommit !== undefined) {
            await fetchStubs(this.directoryOf(kind), plan.stubsCommit, this.options.download ?? download, push);
        }
        const revision = plan.source === 'dev' && plan.checkout !== undefined ? await (this.options.checkoutRevision ?? gitRevision)(plan.checkout) : null;
        if (revision !== null) {
            this.revisions.set(kind, revision);
        }
        await this.writeMarker(target, {
            versions: { [nativeProgramOf(kind)]: plan.version },
            version: plan.version,
            source: plan.source,
            ...(plan.stubsCommit === undefined ? {} : { stubs: plan.stubsCommit }),
            executable: plan.executable,
            ...(revision === null ? {} : { revision })
        });
    }

    private async writeMarker(target: string, marker: Marker): Promise<void> {
        await writeFile(join(target, MARKER), `${JSON.stringify({ ...marker, installedAt: (this.options.now ?? Date.now)() })}\n`);
    }

    /* The new install becomes the one in use and the one it replaces the one to go back to; anything older goes. */
    private async switchTo(kind: LanguageServerKind, id: string): Promise<void> {
        const selection = await this.readSelection(kind);
        const before = (await this.refresh(kind)).current;
        // A build of a checkout runs the checkout's own program, so an earlier build of it is nothing to go back to.
        const replaced = selection === null || selection.current === id || before === null || (id === DEV && before.marker.source === 'dev');
        const previous = replaced ? selection?.previous : selection.current;
        await this.select(kind, { current: id, ...(previous === undefined || previous === id ? {} : { previous }) });
        await this.prune(kind);
    }

    private async select(kind: LanguageServerKind, selection: Selection): Promise<void> {
        const file = join(this.directoryOf(kind), SELECTION);
        const partial = `${file}.partial`;
        await writeFile(partial, `${JSON.stringify(selection)}\n`);
        await rename(partial, file);
        await this.refresh(kind);
    }

    /* Removes the installs other than the one in use and the one to go back to, and the stubs neither of them reads. */
    private async prune(kind: LanguageServerKind): Promise<void> {
        const { current, previous } = this.known.get(kind) ?? { current: null, previous: null };
        const kept = new Set([current?.id, previous?.id]);
        const versions = join(this.directoryOf(kind), VERSIONS);
        for (const id of await readdir(versions).catch(() => [] as string[])) {
            if (!kept.has(id)) {
                await rm(join(versions, id), { recursive: true, force: true });
            }
        }
        if (!kept.has(LEGACY)) {
            for (const entry of LEGACY_ENTRIES) {
                await rm(join(this.directoryOf(kind), entry), { recursive: true, force: true });
            }
        }
        if (isNativeKind(kind) && nativeHasStubs(kind)) {
            const read = new Set([current?.marker.stubs, previous?.marker.stubs]);
            const stubs = join(nativeStorageOf(this.directoryOf(kind)), 'stubs');
            for (const commit of await readdir(stubs).catch(() => [] as string[])) {
                if (!read.has(commit.replace(/\.partial$/, ''))) {
                    await rm(join(stubs, commit), { recursive: true, force: true });
                }
            }
        }
    }

    private async build(kind: NativeKind, plan: NativePlan, push: (line: string) => void): Promise<void> {
        const env = { PATH: `${process.env.PATH ?? ''}${delimiter}${join(homedir(), '.cargo', 'bin')}` };
        let code: number;
        try {
            code = await this.run({ command: cargoCommand(), args: ['build', '--release', '--locked'], cwd: plan.checkout!, env }, push);
        } catch {
            throw new Error(`cargo is not installed, and the ${nativeTitleOf(kind)} server is built with it when Ruimte runs from a checkout`);
        }
        if (code !== 0) {
            throw new Error(`cargo build exited with code ${code}`);
        }
    }

    /* A download or a build of another platform leaves a file that only looks right, so it has to run here and say the pinned version. */
    private async verifyNative(plan: NativePlan, push: (line: string) => void): Promise<void> {
        const lines: string[] = [];
        const code = await this.run({ command: plan.executable, args: ['--version'], cwd: dirname(plan.executable), env: {} }, (line) => {
            lines.push(line);
            push(line);
        });
        if (code !== 0 || !lines.some((line) => line.includes(plan.version))) {
            throw new Error(`The server did not report version ${plan.version}`);
        }
    }
}
