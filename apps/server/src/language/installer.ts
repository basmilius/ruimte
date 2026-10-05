import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import type { LanguageServerKind } from '@ruimte/contracts';
import { errorText } from '../error-text.ts';
import { LanguageLog } from './log.ts';
import {
    cargoCommand,
    download,
    fetchStubs,
    installRelease,
    isNativeKind,
    nativeStubsOf,
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

export type InstallState = 'installed' | 'installing' | 'missing';

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
}

async function exists(path: string): Promise<boolean> {
    return access(path).then(
        () => true,
        () => false
    );
}

/* The name a native server is pinned under in the marker, which the npm kinds keep their package names in. */
const NATIVE_PIN = 'php-language-server';

interface Marker {
    versions?: Record<string, string>;
    /* Native kinds: whether a checkout built the server or a release supplied it, and the stubs installed beside it. */
    source?: string;
    stubs?: string;
}

/*
 * Puts the pinned servers of a kind under `$RUIMTE_HOME/language-servers/<kind>`, with the daemon's own
 * runtime acting as `bun install`, and never on its own: `install` is called for a person's request
 * only. Scripts of the packages do not run. The kind counts as installed once a marker naming the
 * pinned versions exists beside the packages, so a version that moved here reads as missing. A server
 * that is a program of its own has to print its version before the marker is written. A native kind
 * (`native.ts`) is not packages: a checkout builds its server with cargo, a release is downloaded and
 * checked against its pinned SHA-256, and either way the standard library stubs come with it.
 */
export class LanguageInstaller {
    private readonly options: LanguageInstallerOptions;
    private readonly run: RunCommand;
    private readonly installing = new Map<LanguageServerKind, Promise<void>>();
    private readonly failures = new Map<LanguageServerKind, string>();
    private readonly logs = new Map<LanguageServerKind, LanguageLog>();
    private readonly native: NativePolicy;

    constructor(options: LanguageInstallerOptions) {
        this.options = options;
        this.run = options.run ?? runCommand;
        this.native = options.native ?? new NativePolicy({ checkout: null });
    }

    /* The version a kind is at, which for a native kind is the one its checkout or release names, and empty with neither. */
    versionOf(kind: LanguageServerKind): string {
        return isNativeKind(kind) ? (this.planOf(kind)?.version ?? '') : versionOf(kind);
    }

    /* A native kind this build has no way to install: no checkout to build from and no release pinned. */
    isUnavailable(kind: LanguageServerKind): boolean {
        return isNativeKind(kind) && this.planOf(kind) === null;
    }

    /* What a native kind runs, once installed. Null for any other kind, and for one this build cannot install. */
    launchOf(kind: LanguageServerKind): { executable: string; stubsCommit: string } | null {
        const plan = isNativeKind(kind) ? this.planOf(kind) : null;
        return plan === null ? null : { executable: plan.executable, stubsCommit: plan.stubsCommit };
    }

    private planOf(kind: NativeKind): NativePlan | null {
        return this.native.plan(kind, this.directoryOf(kind));
    }

    directoryOf(kind: LanguageServerKind): string {
        return join(this.options.root, kind);
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

    /* Whether the kind was installed at versions other than the pinned ones, so an install brings it up to date. */
    async isOutdated(kind: LanguageServerKind): Promise<boolean> {
        const marker = await this.readMarker(kind);
        return marker !== null && !this.matchesPins(kind, marker);
    }

    private async readMarker(kind: LanguageServerKind): Promise<Marker | null> {
        try {
            const marker = JSON.parse(await readFile(join(this.directoryOf(kind), MARKER), 'utf8')) as Marker;
            return { ...marker, versions: marker.versions ?? {} };
        } catch {
            return null;
        }
    }

    private matchesPins(kind: LanguageServerKind, marker: Marker): boolean {
        if (isNativeKind(kind)) {
            const plan = this.planOf(kind);
            return plan !== null && marker.versions?.[NATIVE_PIN] === plan.version && marker.source === plan.source && marker.stubs === plan.stubsCommit;
        }
        return Object.entries(pinnedVersionsOf(kind)).every(([name, version]) => marker.versions?.[name] === version);
    }

    async isInstalled(kind: LanguageServerKind): Promise<boolean> {
        const directory = this.directoryOf(kind);
        const marker = await this.readMarker(kind);
        if (marker === null || !this.matchesPins(kind, marker)) {
            return false;
        }
        if (isNativeKind(kind)) {
            const plan = this.planOf(kind)!;
            return (await exists(plan.executable)) && (await stubsComplete(nativeStubsOf(directory, plan.stubsCommit)));
        }
        const entries = KIND_PROFILES[kind].components.map((component) => join(directory, 'node_modules', component.entry));
        return (await Promise.all(entries.map(exists))).every(Boolean);
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

    /* A server that is a program of its own has to run on this machine and be the version pinned, since an install of another platform or a bad download leaves a file that only looks right. */
    private async verifyPrograms(kind: NpmKind, log: LanguageLog): Promise<void> {
        const directory = this.directoryOf(kind);
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
        const directory = this.directoryOf(kind);
        try {
            if (await this.isInstalled(kind)) {
                return;
            }
            await mkdir(directory, { recursive: true });
            if (isNativeKind(kind)) {
                await this.performNative(kind, log);
                return;
            }
            const dependencies = pinnedVersionsOf(kind);
            await writeFile(
                join(directory, 'package.json'),
                `${JSON.stringify({ name: `ruimte-language-server-${kind}`, private: true, dependencies }, null, 2)}\n`
            );
            log.push(
                'install',
                `Installing ${Object.entries(dependencies)
                    .map(([name, version]) => `${name}@${version}`)
                    .join(', ')}`
            );
            const { runtime } = this.options;
            const code = await this.run(
                { command: runtime.command, args: [...runtime.args, 'install', '--ignore-scripts'], cwd: directory, env: runtime.env },
                (line) => log.push('install', line)
            );
            if (code !== 0) {
                throw new Error(`The installer exited with code ${code}`);
            }
            const entries = KIND_PROFILES[kind].components.map((component) => join(directory, 'node_modules', component.entry));
            for (const entry of entries) {
                if (!(await exists(entry))) {
                    throw new Error(`The install did not leave ${entry}`);
                }
            }
            await this.verifyPrograms(kind, log);
            await writeFile(join(directory, MARKER), `${JSON.stringify({ versions: dependencies, installedAt: (this.options.now ?? Date.now)() })}\n`);
            log.push('install', 'Installed');
        } catch (error) {
            const message = errorText(error);
            this.failures.set(kind, message);
            log.push('install', `Failed: ${message}`);
        }
    }

    private async performNative(kind: NativeKind, log: LanguageLog): Promise<void> {
        const directory = this.directoryOf(kind);
        const plan = this.planOf(kind);
        if (plan === null) {
            throw new Error('Not available in this build yet');
        }
        const push = (line: string): void => log.push('install', line);
        if (plan.source === 'dev') {
            push(`Building ${plan.version} from ${plan.checkout}`);
            await this.build(plan, push);
        } else {
            if (plan.asset === undefined) {
                throw new Error(`This release has no build for ${process.platform}-${process.arch}`);
            }
            await installRelease(plan.asset, directory, this.options.download ?? download, push);
        }
        if (!(await exists(plan.executable))) {
            throw new Error(`The install did not leave ${plan.executable}`);
        }
        await this.verifyNative(plan, push);
        await fetchStubs(directory, plan.stubsCommit, this.options.download ?? download, push);
        await writeFile(
            join(directory, MARKER),
            `${JSON.stringify({ versions: { [NATIVE_PIN]: plan.version }, source: plan.source, stubs: plan.stubsCommit, installedAt: (this.options.now ?? Date.now)() })}\n`
        );
        push('Installed');
    }

    private async build(plan: NativePlan, push: (line: string) => void): Promise<void> {
        const env = { PATH: `${process.env.PATH ?? ''}${delimiter}${join(homedir(), '.cargo', 'bin')}` };
        let code: number;
        try {
            code = await this.run({ command: cargoCommand(), args: ['build', '--release', '--locked'], cwd: plan.checkout!, env }, push);
        } catch {
            throw new Error('cargo is not installed, and the PHP server is built with it when Ruimte runs from a checkout');
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
