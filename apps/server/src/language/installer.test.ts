import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { LanguageServerKind } from '@ruimte/contracts';
import { LanguageInstaller } from './installer.ts';
import { NativePolicy, nativeStubsOf, type Download, type NativeRelease } from './native.ts';
import { KIND_PROFILES } from './profiles.ts';
import type { LanguageProcessSpec, RunCommand } from './runtime.ts';
import { sha256, tarGz } from './test-archives.ts';

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
        const installer = new LanguageInstaller({
            root,
            runtime,
            run: async () => 0,
            native: new NativePolicy({ checkout: null, releases: {} }),
            onChange: () => undefined
        });
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
        expect(JSON.parse(await readFile(join(root, 'typescript', 'package.json'), 'utf8')).dependencies).toEqual({
            typescript: '7.0.2',
            'typescript-language-server': '6.0.1',
            'typescript-6': 'npm:typescript@6.0.3'
        });
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

const COMMIT = 'b'.repeat(40);
const STUBS_URL = `https://codeload.github.com/JetBrains/phpstorm-stubs/tar.gz/${COMMIT}`;
const STUBS = tarGz([{ path: `stubs-${COMMIT}/standard/a.php`, text: '<?php' }]);

describe('native install', () => {
    const checkout = () => ({ folder: join(root, 'repo'), version: '0.1.0', stubsCommit: COMMIT });
    const devPolicy = () => new NativePolicy({ checkout: checkout() });

    /* Plays cargo, which leaves the executable where a build does, and the executable's own `--version`. */
    function building(calls: LanguageProcessSpec[] = [], version = 'php-language-server 0.1.0'): RunCommand {
        return async (spec, onLine) => {
            calls.push(spec);
            if (spec.args.includes('--version')) {
                onLine(version);
                return 0;
            }
            onLine('Compiling php-language-server');
            await mkdir(join(spec.cwd, 'target', 'release'), { recursive: true });
            await writeFile(join(spec.cwd, 'target', 'release', 'php-language-server'), '');
            return 0;
        };
    }

    const downloads =
        (requested: string[] = []): Download =>
        async (url, destination) => {
            requested.push(url);
            if (url !== STUBS_URL) {
                throw new Error(`${url} answered 404`);
            }
            await writeFile(destination, STUBS);
        };

    it('builds the checkout with cargo, checks the binary, fetches the stubs and then counts as installed', async () => {
        const calls: LanguageProcessSpec[] = [];
        const requested: string[] = [];
        const installer = new LanguageInstaller({
            root,
            runtime,
            run: building(calls),
            native: devPolicy(),
            download: downloads(requested),
            onChange: () => undefined
        });
        expect(await installer.state('php-native')).toBe('missing');
        await installer.install('php-native');
        expect(installer.failureOf('php-native')).toBeNull();
        expect(await installer.state('php-native')).toBe('installed');
        expect(calls[0]).toMatchObject({ args: ['build', '--release', '--locked'], cwd: join(root, 'repo') });
        expect(calls[1]).toMatchObject({ command: join(root, 'repo', 'target', 'release', 'php-language-server'), args: ['--version'] });
        expect(requested).toEqual([STUBS_URL]);
        expect(await readFile(join(nativeStubsOf(join(root, 'php-native'), COMMIT), 'standard', 'a.php'), 'utf8')).toBe('<?php');
        expect(
            installer
                .logOf('php-native')
                .tail()
                .map((line) => line.text)
        ).toContain('Compiling php-language-server');
        expect(installer.launchOf('php-native')).toEqual({ executable: join(root, 'repo', 'target', 'release', 'php-language-server'), stubsCommit: COMMIT });
        expect(installer.versionOf('php-native')).toBe('0.1.0');
    });

    it('does nothing again for an install that is whole', async () => {
        const calls: LanguageProcessSpec[] = [];
        const installer = new LanguageInstaller({ root, runtime, run: building(calls), native: devPolicy(), download: downloads(), onChange: () => undefined });
        await installer.install('php-native');
        await installer.install('php-native');
        expect(calls).toHaveLength(2);
    });

    it('reads the kind as missing when the stubs are gone, and as outdated when the server moved on', async () => {
        const installer = new LanguageInstaller({ root, runtime, run: building(), native: devPolicy(), download: downloads(), onChange: () => undefined });
        await installer.install('php-native');
        await rm(join(nativeStubsOf(join(root, 'php-native'), COMMIT), '.complete'));
        expect(await installer.state('php-native')).toBe('missing');
        await installer.install('php-native');
        expect(await installer.state('php-native')).toBe('installed');
        const newer = new LanguageInstaller({
            root,
            runtime,
            native: new NativePolicy({ checkout: { ...checkout(), version: '0.2.0' } }),
            onChange: () => undefined
        });
        expect(await newer.isOutdated('php-native')).toBe(true);
        expect(await newer.state('php-native')).toBe('missing');
    });

    it('says why when cargo is missing or the build fails', async () => {
        const missing = new LanguageInstaller({
            root,
            runtime,
            run: async () => {
                throw new Error('spawn cargo ENOENT');
            },
            native: devPolicy(),
            download: downloads(),
            onChange: () => undefined
        });
        await missing.install('php-native');
        expect(missing.failureOf('php-native')).toContain('cargo is not installed');
        const failing = new LanguageInstaller({ root, runtime, run: async () => 101, native: devPolicy(), download: downloads(), onChange: () => undefined });
        await failing.install('php-native');
        expect(failing.failureOf('php-native')).toBe('cargo build exited with code 101');
    });

    it('does not count a binary that reports another version', async () => {
        const installer = new LanguageInstaller({
            root,
            runtime,
            run: building([], 'php-language-server 9.9.9'),
            native: devPolicy(),
            download: downloads(),
            onChange: () => undefined
        });
        await installer.install('php-native');
        expect(installer.failureOf('php-native')).toBe('The server did not report version 0.1.0');
        expect(await installer.state('php-native')).toBe('missing');
    });

    it('fails an install whose stubs cannot be downloaded, and leaves the kind missing', async () => {
        const installer = new LanguageInstaller({
            root,
            runtime,
            run: building(),
            native: devPolicy(),
            download: async () => Promise.reject(new Error('offline')),
            onChange: () => undefined
        });
        await installer.install('php-native');
        expect(installer.failureOf('php-native')).toBe('offline');
        expect(await installer.state('php-native')).toBe('missing');
    });

    describe('from a release', () => {
        const binary = tarGz([{ path: 'php-language-server', text: '#!/bin/sh\n', mode: 0o755 }]);
        const release = (checksum = sha256(binary)): NativeRelease => ({
            version: '1.2.3',
            stubsCommit: COMMIT,
            assets: {
                [`${process.platform}-${process.arch}`]: {
                    url: 'https://example.test/server.tar.gz',
                    sha256: checksum,
                    format: 'tar.gz',
                    executable: 'php-language-server'
                }
            }
        });
        const download: Download = async (url, destination) => {
            await writeFile(destination, url === STUBS_URL ? STUBS : binary);
        };
        const versions: RunCommand = async (_spec, onLine) => {
            onLine('php-language-server 1.2.3');
            return 0;
        };

        it('downloads it, checks it and runs it from the install folder', async () => {
            const installer = new LanguageInstaller({
                root,
                runtime,
                run: versions,
                native: new NativePolicy({ checkout: null, releases: { 'php-native': release() } }),
                download,
                onChange: () => undefined
            });
            await installer.install('php-native');
            expect(installer.failureOf('php-native')).toBeNull();
            expect(await installer.state('php-native')).toBe('installed');
            expect(installer.launchOf('php-native')?.executable).toBe(join(root, 'php-native', 'bin', 'php-language-server'));
            expect(installer.versionOf('php-native')).toBe('1.2.3');
        });

        it('stops at a checksum that does not match, before it runs anything', async () => {
            const calls: unknown[] = [];
            const installer = new LanguageInstaller({
                root,
                runtime,
                run: async (spec, onLine) => {
                    calls.push(spec);
                    return versions(spec, onLine);
                },
                native: new NativePolicy({ checkout: null, releases: { 'php-native': release('0'.repeat(64)) } }),
                download,
                onChange: () => undefined
            });
            await installer.install('php-native');
            expect(installer.failureOf('php-native')).toContain('does not match its checksum');
            expect(calls).toEqual([]);
            expect(await installer.state('php-native')).toBe('missing');
        });
    });

    it('has nothing to install in a build with neither a checkout nor a release', async () => {
        const installer = new LanguageInstaller({
            root,
            runtime,
            run: async () => 0,
            native: new NativePolicy({ checkout: null, releases: {} }),
            onChange: () => undefined
        });
        expect(installer.isUnavailable('php-native')).toBe(true);
        expect(installer.isUnavailable('php')).toBe(false);
        expect(installer.versionOf('php-native')).toBe('');
        await installer.install('php-native');
        expect(installer.failureOf('php-native')).toBe('Not available in this build yet');
        expect(await installer.state('php-native')).toBe('missing');
    });
});
