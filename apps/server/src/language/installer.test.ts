import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { LanguageServerKind } from '@ruimte/contracts';
import { LanguageInstaller } from './installer.ts';
import { KIND_PROFILES } from './profiles.ts';
import type { RunCommand } from './runtime.ts';

let root = '';

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-installer-'));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

const runtime = { command: '/ruimte', args: [], env: { BUN_BE_BUN: '1' } };

/* Plays `bun install`: leaves every entry script of the kind where the packages would be. */
function installing(kind: LanguageServerKind, calls: { cwd: string; args: string[]; env: Record<string, string> }[] = []): RunCommand {
    return async (spec, onLine) => {
        calls.push({ cwd: spec.cwd, args: spec.args, env: spec.env });
        onLine('bun install v1');
        for (const component of KIND_PROFILES[kind].components) {
            const entry = join(spec.cwd, 'node_modules', component.entry);
            await mkdir(dirname(entry), { recursive: true });
            await writeFile(entry, '');
        }
        return 0;
    };
}

describe('language installer', () => {
    it('installs the pinned packages with the daemon as bun, scripts off, and then counts as installed', async () => {
        const calls: { cwd: string; args: string[]; env: Record<string, string> }[] = [];
        const changes: string[] = [];
        const installer = new LanguageInstaller({ root, runtime, run: installing('php', calls), onChange: (kind) => changes.push(kind) });
        expect(await installer.state('php')).toBe('missing');
        await installer.install('php');
        expect(await installer.state('php')).toBe('installed');
        expect(calls).toEqual([{ cwd: join(root, 'php'), args: ['install', '--ignore-scripts'], env: { BUN_BE_BUN: '1' } }]);
        expect(JSON.parse(await readFile(join(root, 'php', 'package.json'), 'utf8'))).toEqual({
            name: 'ruimte-language-server-php',
            private: true,
            dependencies: { intelephense: '1.18.5' }
        });
        expect(changes).toEqual(['php', 'php']);
        expect(
            installer
                .logOf('php')
                .tail()
                .map((line) => line.text)
        ).toEqual(['Installing intelephense@1.18.5', 'bun install v1', 'Installed']);
    });

    it('shares the install that is running and does nothing for one that is done', async () => {
        const calls: unknown[] = [];
        const installer = new LanguageInstaller({ root, runtime, run: installing('php', calls as never), onChange: () => undefined });
        const first = installer.install('php');
        expect(await installer.state('php')).toBe('installing');
        const second = installer.install('php');
        expect(second).toBe(first);
        await first;
        await installer.install('php');
        expect(calls).toHaveLength(1);
    });

    it('keeps why an install failed, leaves the kind missing and throws nothing', async () => {
        const installer = new LanguageInstaller({
            root,
            runtime,
            run: async (_spec, onLine) => {
                onLine('error: network is unreachable');
                return 1;
            },
            onChange: () => undefined
        });
        await installer.install('typescript');
        expect(await installer.state('typescript')).toBe('missing');
        expect(installer.failureOf('typescript')).toBe('The installer exited with code 1');
        expect(
            installer
                .logOf('typescript')
                .tail()
                .map((line) => line.text)
        ).toContain('error: network is unreachable');
        await installer.install('typescript');
        expect(installer.failureOf('typescript')).toBe('The installer exited with code 1');
    });

    it('fails when the packages are not where the servers run from', async () => {
        const installer = new LanguageInstaller({ root, runtime, run: async () => 0, onChange: () => undefined });
        await installer.install('php');
        expect(installer.failureOf('php')).toContain('did not leave');
        expect(await installer.state('php')).toBe('missing');
    });

    it('runs a native server once after the install and counts the kind as installed when it reports the pinned version', async () => {
        const calls: { command: string; args: string[] }[] = [];
        const install = installing('typescript');
        const installer = new LanguageInstaller({
            root,
            runtime,
            run: async (spec, onLine) => {
                calls.push({ command: spec.command, args: spec.args });
                if (spec.args.includes('--version')) {
                    onLine('Version 7.0.2');
                    return 0;
                }
                return install(spec, onLine);
            },
            onChange: () => undefined
        });
        await installer.install('typescript');
        expect(installer.failureOf('typescript')).toBeNull();
        expect(await installer.state('typescript')).toBe('installed');
        expect(calls.map((call) => call.args)).toEqual([['install', '--ignore-scripts'], ['--version']]);
        expect(calls[1]!.command).toBe(join(root, 'typescript', 'node_modules', KIND_PROFILES.typescript.components[0]!.entry));
        expect(JSON.parse(await readFile(join(root, 'typescript', 'package.json'), 'utf8')).dependencies).toEqual({ typescript: '7.0.2' });
    });

    it('does not count a native server that reports another version or fails as installed', async () => {
        for (const [code, line] of [
            [0, 'Version 6.0.3'],
            [1, 'Version 7.0.2']
        ] as const) {
            const install = installing('typescript');
            const installer = new LanguageInstaller({
                root,
                runtime,
                run: async (spec, onLine) => {
                    if (spec.args.includes('--version')) {
                        onLine(line);
                        return code;
                    }
                    return install(spec, onLine);
                },
                onChange: () => undefined
            });
            await installer.install('typescript');
            expect(installer.failureOf('typescript')).toBe('The typescript server did not report version 7.0.2');
            expect(await installer.state('typescript')).toBe('missing');
        }
    });

    it('says an install of other versions is outdated, and one that never was is not', async () => {
        const installer = new LanguageInstaller({ root, runtime, run: installing('php'), onChange: () => undefined });
        expect(await installer.isOutdated('php')).toBe(false);
        await installer.install('php');
        expect(await installer.isOutdated('php')).toBe(false);
        await writeFile(join(root, 'php', 'installed.json'), JSON.stringify({ versions: { intelephense: '1.0.0' } }));
        expect(await installer.isOutdated('php')).toBe(true);
    });

    it('reads an install of other versions as missing', async () => {
        const installer = new LanguageInstaller({ root, runtime, run: installing('php'), onChange: () => undefined });
        await installer.install('php');
        await writeFile(join(root, 'php', 'installed.json'), JSON.stringify({ versions: { intelephense: '1.0.0' } }));
        expect(await installer.state('php')).toBe('missing');
    });
});
