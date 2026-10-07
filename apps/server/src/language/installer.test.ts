import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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

/* The folder of the install a kind runs, as its `current.json` names it. */
async function currentFolder(kind: LanguageServerKind): Promise<string> {
    const { current } = JSON.parse(await readFile(join(root, kind, 'current.json'), 'utf8')) as { current: string };
    return current === 'legacy' ? join(root, kind) : join(root, kind, 'versions', current);
}

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
        const folder = await currentFolder('php');
        expect(folder).toStartWith(join(root, 'php', 'versions', '1.18.5-'));
        expect(installer.installDirectoryOf('php')).toBe(folder);
        expect(calls).toEqual([{ cwd: folder, args: ['install', '--ignore-scripts'], env: { BUN_BE_BUN: '1' } }]);
        expect(JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'))).toEqual({
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
            native: new NativePolicy({ checkouts: {}, releases: {} }),
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
        const folder = await currentFolder('typescript');
        expect(calls[1]!.command).toBe(join(folder, 'node_modules', KIND_PROFILES.typescript.components[0]!.entry));
        expect(JSON.parse(await readFile(join(folder, 'package.json'), 'utf8')).dependencies).toEqual({
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

    it('keeps an install of other versions in use, from before installs had a folder each, and offers the pinned one', async () => {
        const entry = join(root, 'php', 'node_modules', KIND_PROFILES.php.components[0]!.entry);
        await mkdir(dirname(entry), { recursive: true });
        await writeFile(entry, '');
        await writeFile(join(root, 'php', 'installed.json'), JSON.stringify({ versions: { intelephense: '1.0.0' } }));
        const switched: string[] = [];
        const installer = new LanguageInstaller({
            root,
            runtime,
            run: installing('php'),
            onChange: () => undefined,
            onSwitched: (kind) => switched.push(kind)
        });
        expect(await installer.state('php')).toBe('installed');
        expect(installer.versionOf('php')).toBe('1.0.0');
        expect(installer.updateOf('php')).toEqual({ version: '1.18.5' });
        expect(installer.installDirectoryOf('php')).toBe(join(root, 'php'));
        await installer.install('php');
        expect(switched).toEqual(['php']);
        expect(installer.versionOf('php')).toBe('1.18.5');
        expect(installer.updateOf('php')).toBeNull();
        expect(installer.previousOf('php')).toBe('1.0.0');
        // The step back stays whole until the next update.
        expect(await readFile(entry, 'utf8')).toBe('');
    });

    it('offers nothing over a kind that is not installed, nor a step back', async () => {
        const installer = new LanguageInstaller({ root, runtime, run: installing('php'), onChange: () => undefined });
        expect(await installer.state('php')).toBe('missing');
        expect(installer.updateOf('php')).toBeNull();
        expect(installer.previousOf('php')).toBeNull();
        expect(installer.versionOf('php')).toBe('1.18.5');
    });
});

const COMMIT = 'b'.repeat(40);
const STUBS_URL = `https://codeload.github.com/JetBrains/phpstorm-stubs/tar.gz/${COMMIT}`;
const STUBS = tarGz([{ path: `stubs-${COMMIT}/standard/a.php`, text: '<?php' }]);

describe('native install', () => {
    const checkout = () => ({ folder: join(root, 'repo'), version: '0.1.0', stubsCommit: COMMIT });
    const devPolicy = () => new NativePolicy({ checkouts: { 'php-native': checkout() } });

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

    it('reads the kind as missing when the stubs are gone, and offers a build when the checkout moved on to another version', async () => {
        const installer = new LanguageInstaller({ root, runtime, run: building(), native: devPolicy(), download: downloads(), onChange: () => undefined });
        await installer.install('php-native');
        await rm(join(nativeStubsOf(join(root, 'php-native'), COMMIT), '.complete'));
        expect(await installer.state('php-native')).toBe('missing');
        await installer.install('php-native');
        expect(await installer.state('php-native')).toBe('installed');
        const newer = new LanguageInstaller({
            root,
            runtime,
            native: new NativePolicy({ checkouts: { 'php-native': { ...checkout(), version: '0.2.0' } } }),
            onChange: () => undefined
        });
        expect(await newer.state('php-native')).toBe('installed');
        expect(newer.versionOf('php-native')).toBe('0.1.0');
        expect(newer.updateOf('php-native')).toEqual({ version: '0.2.0', rebuild: true });
    });

    it('offers a build again when the checkout changed since the last one, and builds it in place', async () => {
        const calls: LanguageProcessSpec[] = [];
        let revision = 'aaa';
        const installer = new LanguageInstaller({
            root,
            runtime,
            run: building(calls),
            native: devPolicy(),
            download: downloads(),
            checkoutRevision: async () => revision,
            onChange: () => undefined
        });
        await installer.install('php-native');
        await installer.refreshCheckouts();
        expect(installer.updateOf('php-native')).toBeNull();
        revision = 'bbb+1234';
        expect(installer.updateOf('php-native')).toBeNull();
        await installer.refreshCheckouts();
        expect(installer.updateOf('php-native')).toEqual({ version: '0.1.0', rebuild: true });
        await installer.install('php-native');
        expect(calls.filter((call) => call.args[0] === 'build')).toHaveLength(2);
        expect(installer.updateOf('php-native')).toBeNull();
        expect(installer.previousOf('php-native')).toBeNull();
        expect(JSON.parse(await readFile(join(root, 'php-native', 'versions', 'dev', 'installed.json'), 'utf8'))).toMatchObject({ revision: 'bbb+1234' });
    });

    it('keeps no earlier build of a checkout to go back to, since every build runs the same program', async () => {
        await mkdir(join(root, 'php-native'), { recursive: true });
        await writeFile(
            join(root, 'php-native', 'installed.json'),
            JSON.stringify({ versions: { 'php-language-server': '0.0.9' }, source: 'dev', stubs: COMMIT })
        );
        const installer = new LanguageInstaller({ root, runtime, run: building(), native: devPolicy(), download: downloads(), onChange: () => undefined });
        expect(installer.updateOf('php-native')).toBeNull();
        await installer.state('php-native');
        await installer.install('php-native');
        expect(installer.versionOf('php-native')).toBe('0.1.0');
        expect(installer.previousOf('php-native')).toBeNull();
        expect((await readdir(join(root, 'php-native'))).sort()).toEqual(['current.json', 'storage', 'versions']);
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
            sourceRevision: COMMIT,
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
                native: new NativePolicy({ checkouts: {}, releases: { 'php-native': release() } }),
                download,
                onChange: () => undefined
            });
            await installer.install('php-native');
            expect(installer.failureOf('php-native')).toBeNull();
            expect(await installer.state('php-native')).toBe('installed');
            expect(installer.launchOf('php-native')?.executable).toBe(join(root, 'php-native', 'versions', '1.2.3', 'bin', 'php-language-server'));
            expect(installer.installDirectoryOf('php-native')).toBe(join(root, 'php-native'));
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
                native: new NativePolicy({ checkouts: {}, releases: { 'php-native': release('0'.repeat(64)) } }),
                download,
                onChange: () => undefined
            });
            await installer.install('php-native');
            expect(installer.failureOf('php-native')).toContain('does not match its checksum');
            expect(calls).toEqual([]);
            expect(await installer.state('php-native')).toBe('missing');
        });
    });

    describe('updates of a release', () => {
        const binary = tarGz([{ path: 'php-language-server', text: '#!/bin/sh\n', mode: 0o755 }]);
        const OTHER = 'c'.repeat(40);
        const releaseOf = (version: string, stubsCommit = COMMIT, checksum = sha256(binary)): NativeRelease => ({
            sourceRevision: COMMIT,
            version,
            stubsCommit,
            assets: {
                [`${process.platform}-${process.arch}`]: {
                    url: `https://example.test/${version}.tar.gz`,
                    sha256: checksum,
                    format: 'tar.gz',
                    executable: 'php-language-server'
                }
            }
        });
        const downloading =
            (fetched: string[] = []): Download =>
            async (url, destination) => {
                fetched.push(url);
                const commit = url.startsWith('https://codeload.github.com/') ? url.slice(url.lastIndexOf('/') + 1) : null;
                await writeFile(destination, commit === null ? binary : tarGz([{ path: `stubs-${commit}/standard/a.php`, text: '<?php' }]));
            };
        const installerFor = (release: NativeRelease, switched: string[] = [], fetched: string[] = []) =>
            new LanguageInstaller({
                root,
                runtime,
                run: async (_spec, onLine) => {
                    onLine(`php-language-server ${release.version}`);
                    return 0;
                },
                native: new NativePolicy({ checkouts: {}, releases: { 'php-native': release } }),
                download: downloading(fetched),
                onChange: () => undefined,
                onSwitched: (kind) => switched.push(kind)
            });
        const programOf = (version: string) => join(root, 'php-native', 'versions', version, 'bin', 'php-language-server');

        it('keeps the version in use until a person updates, then installs the new one beside it and switches', async () => {
            await installerFor(releaseOf('1.2.3')).install('php-native');
            const switched: string[] = [];
            const newer = installerFor(releaseOf('1.2.4'), switched);
            expect(await newer.state('php-native')).toBe('installed');
            expect(newer.versionOf('php-native')).toBe('1.2.3');
            expect(newer.updateOf('php-native')).toEqual({ version: '1.2.4' });
            expect(newer.launchOf('php-native')?.executable).toBe(programOf('1.2.3'));
            await newer.install('php-native');
            expect(switched).toEqual(['php-native']);
            expect(newer.versionOf('php-native')).toBe('1.2.4');
            expect(newer.updateOf('php-native')).toBeNull();
            expect(newer.previousOf('php-native')).toBe('1.2.3');
            expect(newer.launchOf('php-native')?.executable).toBe(programOf('1.2.4'));
            expect((await readdir(join(root, 'php-native', 'versions'))).sort()).toEqual(['1.2.3', '1.2.4']);
        });

        it('keeps one version to go back to, and the stubs only those two read', async () => {
            await installerFor(releaseOf('1.2.3')).install('php-native');
            await installerFor(releaseOf('1.2.4', OTHER)).install('php-native');
            const latest = installerFor(releaseOf('1.2.5', OTHER));
            await latest.install('php-native');
            expect((await readdir(join(root, 'php-native', 'versions'))).sort()).toEqual(['1.2.4', '1.2.5']);
            expect(await readdir(join(root, 'php-native', 'storage', 'stubs'))).toEqual([OTHER]);
            expect(latest.previousOf('php-native')).toBe('1.2.4');
        });

        it('leaves the version in use as it is when an update fails', async () => {
            await installerFor(releaseOf('1.2.3')).install('php-native');
            const switched: string[] = [];
            const broken = installerFor(releaseOf('1.2.4', COMMIT, '0'.repeat(64)), switched);
            await broken.install('php-native');
            expect(broken.failureOf('php-native')).toContain('does not match its checksum');
            expect(switched).toEqual([]);
            expect(await broken.state('php-native')).toBe('installed');
            expect(broken.versionOf('php-native')).toBe('1.2.3');
            expect(broken.updateOf('php-native')).toEqual({ version: '1.2.4' });
            expect(broken.previousOf('php-native')).toBeNull();
        });

        it('goes back to the version before and forward again without a download, and says when there is none', async () => {
            const first = installerFor(releaseOf('1.2.3'));
            await first.install('php-native');
            await expect(first.rollback('php-native')).rejects.toThrow('no earlier version');
            const switched: string[] = [];
            const fetched: string[] = [];
            const newer = installerFor(releaseOf('1.2.4'), switched, fetched);
            await newer.install('php-native');
            await newer.rollback('php-native');
            expect(newer.versionOf('php-native')).toBe('1.2.3');
            expect(newer.previousOf('php-native')).toBe('1.2.4');
            expect(newer.updateOf('php-native')).toEqual({ version: '1.2.4' });
            expect(newer.launchOf('php-native')?.executable).toBe(programOf('1.2.3'));
            fetched.length = 0;
            await newer.install('php-native');
            expect(fetched).toEqual([]);
            expect(newer.versionOf('php-native')).toBe('1.2.4');
            expect(newer.previousOf('php-native')).toBe('1.2.3');
            expect(switched).toEqual(['php-native', 'php-native', 'php-native']);
        });

        it('takes over a release installed before installs had a folder each, and removes it once it is two versions back', async () => {
            const legacy = join(root, 'php-native', 'bin', 'php-language-server');
            await mkdir(dirname(legacy), { recursive: true });
            await writeFile(legacy, '');
            const stubs = nativeStubsOf(join(root, 'php-native'), COMMIT);
            await mkdir(stubs, { recursive: true });
            await writeFile(join(stubs, '.complete'), '');
            await writeFile(
                join(root, 'php-native', 'installed.json'),
                JSON.stringify({ versions: { 'php-language-server': '1.2.2' }, source: 'release', stubs: COMMIT })
            );
            const newer = installerFor(releaseOf('1.2.4'));
            expect(await newer.state('php-native')).toBe('installed');
            expect(newer.versionOf('php-native')).toBe('1.2.2');
            expect(newer.launchOf('php-native')).toEqual({ executable: legacy, stubsCommit: COMMIT });
            await newer.install('php-native');
            expect(newer.previousOf('php-native')).toBe('1.2.2');
            await installerFor(releaseOf('1.2.5')).install('php-native');
            expect((await readdir(join(root, 'php-native'))).sort()).toEqual(['current.json', 'storage', 'versions']);
        });
    });

    it('has nothing to install in a build with neither a checkout nor a release', async () => {
        const installer = new LanguageInstaller({
            root,
            runtime,
            run: async () => 0,
            native: new NativePolicy({ checkouts: {}, releases: {} }),
            onChange: () => undefined
        });
        expect(installer.isUnavailable('php-native')).toBe(true);
        expect(installer.isUnavailable('php')).toBe(false);
        expect(installer.versionOf('php-native')).toBe('');
        await installer.install('php-native');
        expect(installer.failureOf('php-native')).toBe('No release of this server is available yet');
        expect(await installer.state('php-native')).toBe('missing');
    });
});

describe('the SQL server install', () => {
    const checkout = () => ({ folder: join(root, 'sql'), version: '0.1.3' });

    /* Plays cargo in the SQL checkout and the program's own `--version`. */
    function building(calls: LanguageProcessSpec[] = []): RunCommand {
        return async (spec, onLine) => {
            calls.push(spec);
            if (spec.args.includes('--version')) {
                onLine('sql-language-server 0.1.3');
                return 0;
            }
            await mkdir(join(spec.cwd, 'target', 'release'), { recursive: true });
            await writeFile(join(spec.cwd, 'target', 'release', 'sql-language-server'), '');
            return 0;
        };
    }

    it('builds the checkout and counts as installed without any stubs, which it never downloads', async () => {
        const calls: LanguageProcessSpec[] = [];
        const requested: string[] = [];
        const installer = new LanguageInstaller({
            root,
            runtime,
            run: building(calls),
            native: new NativePolicy({ checkouts: { 'sql-native': checkout() } }),
            download: async (url) => {
                requested.push(url);
            },
            onChange: () => undefined
        });
        await installer.install('sql-native');
        expect(installer.failureOf('sql-native')).toBeNull();
        expect(await installer.state('sql-native')).toBe('installed');
        expect(calls.map((call) => call.args)).toEqual([['build', '--release', '--locked'], ['--version']]);
        expect(requested).toEqual([]);
        expect(installer.launchOf('sql-native')).toEqual({ executable: join(root, 'sql', 'target', 'release', 'sql-language-server') });
        const marker = JSON.parse(await readFile(join(await currentFolder('sql-native'), 'installed.json'), 'utf8')) as Record<string, unknown>;
        expect(marker).toMatchObject({ versions: { 'sql-language-server': '0.1.3' }, source: 'dev' });
        expect(marker).not.toHaveProperty('stubs');
        expect(installer.updateOf('sql-native')).toBeNull();
    });

    it('says plainly that no release is available in a build without a checkout or a pin, and leaves PHP alone', async () => {
        const installer = new LanguageInstaller({
            root,
            runtime,
            run: async () => 0,
            native: new NativePolicy({ checkouts: { 'php-native': { folder: join(root, 'php'), version: '0.4.1', stubsCommit: COMMIT } }, releases: {} }),
            onChange: () => undefined
        });
        expect(installer.isUnavailable('sql-native')).toBe(true);
        expect(installer.isUnavailable('php-native')).toBe(false);
        await installer.install('sql-native');
        expect(installer.failureOf('sql-native')).toBe('No release of this server is available yet');
    });

    it('names the server it could not build when cargo is missing', async () => {
        const installer = new LanguageInstaller({
            root,
            runtime,
            run: async (spec) => {
                if (spec.args[0] === 'build') {
                    throw new Error('ENOENT');
                }
                return 0;
            },
            native: new NativePolicy({ checkouts: { 'sql-native': checkout() } }),
            onChange: () => undefined
        });
        await installer.install('sql-native');
        expect(installer.failureOf('sql-native')).toBe('cargo is not installed, and the SQL server is built with it when Ruimte runs from a checkout');
    });
});
