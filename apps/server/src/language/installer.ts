import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LanguageServerKind } from '@ruimte/contracts';
import { errorText } from '../error-text.ts';
import { LanguageLog } from './log.ts';
import { KIND_PROFILES } from './profiles.ts';
import { runCommand, type LanguageRuntime, type RunCommand } from './runtime.ts';
import { LANGUAGE_KIND_PACKAGES, pinnedVersionsOf } from './versions.ts';

const MARKER = 'installed.json';

export type InstallState = 'installed' | 'installing' | 'missing';

export interface LanguageInstallerOptions {
    /* `$RUIMTE_HOME/language-servers`. */
    root: string;
    runtime: LanguageRuntime;
    run?: RunCommand;
    now?: () => number;
    /* A kind changed state: an install began or ended. */
    onChange: (kind: LanguageServerKind) => void;
}

async function exists(path: string): Promise<boolean> {
    return access(path).then(
        () => true,
        () => false
    );
}

/*
 * Puts the pinned servers of a kind under `$RUIMTE_HOME/language-servers/<kind>`, with the daemon's own
 * runtime acting as `bun install`, and never on its own: `install` is called for a person's request
 * only. Scripts of the packages do not run. The kind counts as installed once a marker naming the
 * pinned versions exists beside the packages, so a version that moved here reads as missing.
 */
export class LanguageInstaller {
    private readonly options: LanguageInstallerOptions;
    private readonly run: RunCommand;
    private readonly installing = new Map<LanguageServerKind, Promise<void>>();
    private readonly failures = new Map<LanguageServerKind, string>();
    private readonly logs = new Map<LanguageServerKind, LanguageLog>();

    constructor(options: LanguageInstallerOptions) {
        this.options = options;
        this.run = options.run ?? runCommand;
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

    async isInstalled(kind: LanguageServerKind): Promise<boolean> {
        const directory = this.directoryOf(kind);
        try {
            const marker = JSON.parse(await readFile(join(directory, MARKER), 'utf8')) as { versions?: Record<string, string> };
            const pinned = pinnedVersionsOf(kind);
            if (!Object.entries(pinned).every(([name, version]) => marker.versions?.[name] === version)) {
                return false;
            }
        } catch {
            return false;
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

    private async perform(kind: LanguageServerKind): Promise<void> {
        const log = this.logOf(kind);
        this.failures.delete(kind);
        const directory = this.directoryOf(kind);
        try {
            if (await this.isInstalled(kind)) {
                return;
            }
            await mkdir(directory, { recursive: true });
            const dependencies = pinnedVersionsOf(kind);
            await writeFile(
                join(directory, 'package.json'),
                `${JSON.stringify({ name: `ruimte-language-server-${kind}`, private: true, dependencies }, null, 2)}\n`
            );
            log.push('install', `Installing ${LANGUAGE_KIND_PACKAGES[kind].map((name) => `${name}@${dependencies[name]}`).join(', ')}`);
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
            await writeFile(join(directory, MARKER), `${JSON.stringify({ versions: dependencies, installedAt: (this.options.now ?? Date.now)() })}\n`);
            log.push('install', 'Installed');
        } catch (error) {
            const message = errorText(error);
            this.failures.set(kind, message);
            log.push('install', `Failed: ${message}`);
        }
    }
}
