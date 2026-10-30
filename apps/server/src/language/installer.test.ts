import { beforeEach, describe, expect, it } from 'bun:test';
import { lstat, mkdir, readdir, readFile, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { LanguageInstaller } from './installer.ts';
import { PackageStore } from './package-store.ts';
import { NativePolicy, nativeProgramFile, nativeStubsOf, type Download, type NativeRelease } from './native.ts';
import { KIND_PROFILES, type CatalogKind } from './profiles.ts';
import type { LanguageProcessSpec, RunCommand } from './runtime.ts';
import { sha256, tarGz } from './test-archives.ts';
import { pinnedVersionsOf, versionOf, type NpmKind } from './versions.ts';
import { tempHomes } from '../temp-home-test-helpers.ts';

let root = '';

const newHome = tempHomes('ruimte-installer-');

beforeEach(async () => {
    root = await newHome();
});

const runtime = { command: '/ruimte', args: [], env: { BUN_BE_BUN: '1' } };

/* The folder of the install a kind runs, as its `current.json` names it. */
async function currentFolder(kind: CatalogKind): Promise<string> {
    const { current } = JSON.parse(await readFile(join(root, kind, 'current.json'), 'utf8')) as { current: string };
    return current === 'legacy' ? join(root, kind) : join(root, kind, 'versions', current);
}

/* Plays `bun install`: leaves every entry script of the kind where the packages would be. */
function installing(kind: CatalogKind, calls: { cwd: string; args: string[]; env: Record<string, string> }[] = []): RunCommand {
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

/* The set an install links to. */
async function setOf(folder: string): Promise<string> {
    const { packages } = JSON.parse(await readFile(join(folder, 'installed.json'), 'utf8')) as { packages: string };
    return packages;
}

/* Plays `bun install` for a set that serves several kinds: leaves the entries of all of them. */
function installingAll(kinds: CatalogKind[], calls: string[] = []): RunCommand {
    return async (spec, onLine) => {
        calls.push(spec.cwd);
        onLine('bun install v1');
        for (const component of kinds.flatMap((kind) => KIND_PROFILES[kind].components)) {
            const entry = join(spec.cwd, 'node_modules', component.entry);
            await mkdir(dirname(entry), { recursive: true });
            await writeFile(entry, '');
        }
        return 0;
    };
}

function logTexts(installer: LanguageInstaller, kind: CatalogKind): string[] {
    return installer
        .logOf(kind)
        .tail()
        .map((line) => line.text);
}

describe('language installer', () => {
    it.skipIf(process.platform !== 'win32')('on Windows an install holds its own packages, without a shared set', async () => {
        const calls: { cwd: string; args: string[]; env: Record<string, string> }[] = [];
        const installer = new LanguageInstaller({ root, runtime, run: installing('yaml', calls), now: () => 0, onChange: () => undefined });
        await installer.install('yaml');
        expect(await installer.state('yaml')).toBe('installed');
        const folder = await currentFolder('yaml');
        expect(calls).toEqual([{ cwd: folder, args: ['install', '--ignore-scripts'], env: { BUN_BE_BUN: '1' } }]);
        expect((await lstat(join(folder, 'node_modules'))).isSymbolicLink()).toBe(false);
    });

    it.skipIf(process.platform === 'win32')('installs the pinned packages with the daemon as bun, scripts off, and then counts as installed', async () => {
        const calls: { cwd: string; args: string[]; env: Record<string, string> }[] = [];
        const changes: string[] = [];
        const installer = new LanguageInstaller({ root, runtime, run: installing('yaml', calls), now: () => 0, onChange: (kind) => changes.push(kind) });
        expect(await installer.state('yaml')).toBe('missing');
        await installer.install('yaml');
        expect(await installer.state('yaml')).toBe('installed');
        const folder = await currentFolder('yaml');
        expect(folder).toStartWith(join(root, 'yaml', 'versions', '1.24.0-'));
        expect(installer.installDirectoryOf('yaml')).toBe(folder);
        // The packages are installed once into a staging folder of the store and the install links to the set.
        expect(calls).toEqual([
            { cwd: expect.stringContaining(join(root, 'packages', '.staging')), args: ['install', '--ignore-scripts'], env: { BUN_BE_BUN: '1' } }
        ]);
        const setId = await setOf(folder);
        expect(await readlink(join(folder, 'node_modules'))).toBe(join('..', '..', '..', 'packages', setId, 'node_modules'));
        expect(JSON.parse(await readFile(join(folder, 'installed.json'), 'utf8'))).toMatchObject({ packages: setId });
        expect(JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'))).toEqual({
            name: 'ruimte-language-server-yaml',
            private: true,
            dependencies: { 'yaml-language-server': '1.24.0' }
        });
        expect(changes).toEqual(['yaml', 'yaml']);
        expect(logTexts(installer, 'yaml')).toEqual(['Installing yaml-language-server@1.24.0', 'bun install v1', 'Installed in 0.0 s']);
    });

    it('shares the install that is running and does nothing for one that is done', async () => {
        const calls: unknown[] = [];
        const installer = new LanguageInstaller({ root, runtime, run: installing('yaml', calls as never), onChange: () => undefined });
        const first = installer.install('yaml');
        expect(await installer.state('yaml')).toBe('installing');
        const second = installer.install('yaml');
        expect(second).toBe(first);
        await first;
        await installer.install('yaml');
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
        expect(logTexts(installer, 'typescript')).toContain('error: network is unreachable');
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
        await installer.install('yaml');
        expect(installer.failureOf('yaml')).toContain('did not leave');
        expect(await installer.state('yaml')).toBe('missing');
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
        const entry = join(root, 'yaml', 'node_modules', KIND_PROFILES.yaml.components[0]!.entry);
        await mkdir(dirname(entry), { recursive: true });
        await writeFile(entry, '');
        await writeFile(join(root, 'yaml', 'installed.json'), JSON.stringify({ versions: { 'yaml-language-server': '1.0.0' } }));
        const switched: string[] = [];
        const installer = new LanguageInstaller({
            root,
            runtime,
            run: installing('yaml'),
            onChange: () => undefined,
            onSwitched: (kind) => switched.push(kind)
        });
        expect(await installer.state('yaml')).toBe('installed');
        expect(installer.versionOf('yaml')).toBe('1.0.0');
        expect(installer.updateOf('yaml')).toEqual({ version: '1.24.0' });
        expect(installer.installDirectoryOf('yaml')).toBe(join(root, 'yaml'));
        await installer.install('yaml');
        expect(switched).toEqual(['yaml']);
        expect(installer.versionOf('yaml')).toBe('1.24.0');
        expect(installer.updateOf('yaml')).toBeNull();
        expect(installer.previousOf('yaml')).toBe('1.0.0');
        // The step back stays whole until the next update.
        expect(await readFile(entry, 'utf8')).toBe('');
    });

    it('offers nothing over a kind that is not installed, nor a step back', async () => {
        const installer = new LanguageInstaller({ root, runtime, run: installing('yaml'), onChange: () => undefined });
        expect(await installer.state('yaml')).toBe('missing');
        expect(installer.updateOf('yaml')).toBeNull();
        expect(installer.previousOf('yaml')).toBeNull();
        expect(installer.versionOf('yaml')).toBe('1.24.0');
    });
});

const COMMIT = 'b'.repeat(40);
const STUBS_URL = `https://codeload.github.com/JetBrains/phpstorm-stubs/tar.gz/${COMMIT}`;
const STUBS = tarGz([{ path: `stubs-${COMMIT}/standard/a.php`, text: '<?php' }]);
const BINARY = tarGz([{ path: 'php-language-server', text: '#!/bin/sh\n', mode: 0o755 }]);

const releaseOf = (version: string, stubsCommit = COMMIT, checksum = sha256(BINARY)): NativeRelease => ({
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
            await writeFile(join(spec.cwd, 'target', 'release', nativeProgramFile('php-native', process.platform)), '');
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
        expect(calls[1]).toMatchObject({
            command: join(root, 'repo', 'target', 'release', nativeProgramFile('php-native', process.platform)),
            args: ['--version']
        });
        expect(requested).toEqual([STUBS_URL]);
        expect(await readFile(join(nativeStubsOf(join(root, 'php-native'), COMMIT), 'standard', 'a.php'), 'utf8')).toBe('<?php');
        expect(logTexts(installer, 'php-native')).toContain('Compiling php-language-server');
        expect(installer.launchOf('php-native')).toEqual({
            executable: join(root, 'repo', 'target', 'release', nativeProgramFile('php-native', process.platform)),
            stubsCommit: COMMIT
        });
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
        const download: Download = async (url, destination) => {
            await writeFile(destination, url === STUBS_URL ? STUBS : BINARY);
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
                native: new NativePolicy({ checkouts: {}, releases: { 'php-native': releaseOf('1.2.3') } }),
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
                native: new NativePolicy({ checkouts: {}, releases: { 'php-native': releaseOf('1.2.3', COMMIT, '0'.repeat(64)) } }),
                download,
                onChange: () => undefined
            });
            await installer.install('php-native');
            expect(installer.failureOf('php-native')).toContain('The download is damaged');
            expect(calls).toEqual([]);
            expect(await installer.state('php-native')).toBe('missing');
        });
    });

    describe('updates of a release', () => {
        const OTHER = 'c'.repeat(40);
        const downloading =
            (fetched: string[] = []): Download =>
            async (url, destination) => {
                fetched.push(url);
                const commit = url.startsWith('https://codeload.github.com/') ? url.slice(url.lastIndexOf('/') + 1) : null;
                await writeFile(destination, commit === null ? BINARY : tarGz([{ path: `stubs-${commit}/standard/a.php`, text: '<?php' }]));
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
            expect(broken.failureOf('php-native')).toContain('The download is damaged');
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
            const legacy = join(root, 'php-native', 'bin', nativeProgramFile('php-native', process.platform));
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
        expect(installer.isUnavailable('yaml')).toBe(false);
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
            await writeFile(join(spec.cwd, 'target', 'release', nativeProgramFile('sql-native', process.platform)), '');
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
        expect(installer.launchOf('sql-native')).toEqual({
            executable: join(root, 'sql', 'target', 'release', nativeProgramFile('sql-native', process.platform))
        });
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

    it('finds rust-analyzer where the toolchain put it, never installs it, and says how to get it when it is not there', async () => {
        const executable = join(root, 'cargo', 'bin', 'rust-analyzer');
        const proxy = join(root, 'path', 'rust-analyzer');
        await mkdir(dirname(executable), { recursive: true });
        await mkdir(dirname(proxy), { recursive: true });
        await writeFile(proxy, '');
        const calls: string[] = [];
        const run: RunCommand = async (spec, onLine) => {
            calls.push(spec.command);
            if (spec.command === proxy) {
                onLine("error: Unknown binary 'rust-analyzer' in official toolchain 'stable-aarch64-apple-darwin'.");
                return 1;
            }
            onLine('rust-analyzer 1.85.0 (4d91de4e 2025-02-17)');
            return 0;
        };
        const switched: string[] = [];
        const installer = new LanguageInstaller({
            root,
            runtime,
            run,
            onChange: () => undefined,
            onSwitched: (kind) => switched.push(kind),
            findProgram: () => [proxy, executable]
        });
        await installer.load();
        expect(await installer.state('rust')).toBe('missing');
        expect(installer.failureOf('rust')).toBe(
            'rust-analyzer is not on this machine. It comes with the Rust toolchain: run rustup component add rust-analyzer'
        );
        expect(installer.launchOf('rust')).toBeNull();
        expect(installer.updateOf('rust')).toBeNull();

        await writeFile(executable, '');
        await installer.install('rust');
        expect(await installer.state('rust')).toBe('installed');
        expect(installer.failureOf('rust')).toBeNull();
        expect(installer.versionOf('rust')).toBe('1.85.0 (4d91de4e 2025-02-17)');
        expect(installer.pinnedVersionOf('rust')).toBe('');
        expect(installer.launchOf('rust')).toEqual({ executable });
        expect(switched).toEqual(['rust']);
        expect(calls).toEqual([proxy, proxy, executable]);
        expect(await readdir(root)).not.toContain('rust');
        await expect(installer.rollback('rust')).rejects.toThrow();
    });
});

describe.skipIf(process.platform === 'win32')('shared package sets', () => {
    const SHARED: CatalogKind[] = ['css', 'html', 'json'];

    function sharing(calls: string[] = []): LanguageInstaller {
        return new LanguageInstaller({ root, runtime, run: installingAll(SHARED, calls), onChange: () => undefined });
    }

    it('installs css, html and json from one set and runs bun install once', async () => {
        const calls: string[] = [];
        const installer = sharing(calls);

        for (const kind of SHARED) {
            await installer.install(kind);
            expect(await installer.state(kind)).toBe('installed');
        }

        const sets = await Promise.all(SHARED.map(async (kind) => setOf(await currentFolder(kind))));
        const folders = await Promise.all(SHARED.map(currentFolder));

        expect(calls).toHaveLength(1);
        expect(new Set(sets).size).toBe(1);
        expect((await readdir(join(root, 'packages'))).filter((name) => !name.startsWith('.'))).toEqual(sets.slice(0, 1));
        expect(new Set(folders).size).toBe(3);
    });

    it('removes a stale install folder by unlinking, so the set stays whole for the others', async () => {
        const installer = sharing();

        await installer.install('css');
        await installer.install('html');

        const stale = join(root, 'json', 'versions', 'stale');
        const setId = await setOf(await currentFolder('css'));

        await mkdir(stale, { recursive: true });
        await symlink(join('..', '..', '..', 'packages', setId, 'node_modules'), join(stale, 'node_modules'), 'dir');
        // The install of json prunes its versions folder, stale one included.
        await installer.install('json');

        expect(await readdir(join(root, 'json', 'versions'))).not.toContain('stale');
        expect(await installer.state('css')).toBe('installed');
        expect(await installer.state('html')).toBe('installed');
    });

    it('collects a set no install links to and keeps the one another kind uses', async () => {
        const installer = sharing();

        await installer.install('css');
        await mkdir(join(root, 'packages', 'fedcba9876543210', 'node_modules'), { recursive: true });
        await installer.install('html');

        expect(await readdir(join(root, 'packages'))).not.toContain('fedcba9876543210');
        expect(await installer.state('css')).toBe('installed');
    });

    it('collects nothing when an install folder cannot be read', async () => {
        const installer = sharing();

        await installer.install('css');
        await mkdir(join(root, 'packages', 'fedcba9876543210', 'node_modules'), { recursive: true });
        // A file where the folder of a kind should be makes the walk fail with something other than ENOENT.
        await writeFile(join(root, 'html'), '');
        await installer.install('json');

        expect(await readdir(join(root, 'packages'))).toContain('fedcba9876543210');
    });

    it('reads a kind with a dangling link as missing, and Install repairs it', async () => {
        const calls: string[] = [];
        const installer = sharing(calls);

        await installer.install('css');
        await rm(join(root, 'packages', await setOf(await currentFolder('css'))), { recursive: true });

        expect(await installer.state('css')).toBe('missing');

        await installer.install('css');

        expect(await installer.state('css')).toBe('installed');
        expect(calls).toHaveLength(2);
        expect((await lstat(join(await currentFolder('css'), 'node_modules'))).isSymbolicLink()).toBe(true);
    });

    it('clears an interrupted build from staging when it loads', async () => {
        await mkdir(join(root, 'packages', '.staging', 'left-over'), { recursive: true });
        await sharing().load();

        expect(await readdir(join(root, 'packages')).catch(() => [])).toEqual([]);
    });

    it('goes back to a linked install and logs how long it took', async () => {
        const installer = sharing();

        await installer.install('css');

        const first = await currentFolder('css');
        const setId = await setOf(first);
        const older = join(root, 'css', 'versions', 'older');

        await mkdir(older);
        await symlink(join('..', '..', '..', 'packages', setId, 'node_modules'), join(older, 'node_modules'), 'dir');
        await writeFile(
            join(older, 'installed.json'),
            JSON.stringify({ versions: { 'vscode-langservers-extracted': '4.0.0' }, version: '4.0.0', packages: setId })
        );
        await writeFile(join(root, 'css', 'current.json'), JSON.stringify({ current: basename(first), previous: 'older' }));
        await installer.load();
        await installer.rollback('css');

        expect(installer.versionOf('css')).toBe('4.0.0');
        expect(logTexts(installer, 'css').at(-1)).toMatch(/^Went back to 4\.0\.0 from .* in \d+ ms$/);
    });
});

describe.skipIf(process.platform === 'win32')('adopting installs that hold their own packages', () => {
    /* An install from before package sets: a real node_modules, its manifest, lockfile and marker, selected as current. */
    async function standalone(kind: CatalogKind, id: string, content = ''): Promise<string> {
        const folder = join(root, kind, 'versions', id);
        const dependencies = pinnedVersionsOf(kind as NpmKind);

        await mkdir(folder, { recursive: true });
        await writeFile(join(folder, 'package.json'), JSON.stringify({ name: `ruimte-language-server-${kind}`, private: true, dependencies }));
        await writeFile(join(folder, 'bun.lock'), `{ "workspaces": { "": { "name": "ruimte-language-server-${kind}" } } }`);
        await writeFile(join(folder, 'installed.json'), JSON.stringify({ versions: dependencies, version: versionOf(kind as NpmKind) }));

        // These kinds pin the same package, so a real install of any of them holds the programs of all.
        for (const component of ['css', 'html', 'json'].flatMap((name) => KIND_PROFILES[name as CatalogKind].components)) {
            const entry = join(folder, 'node_modules', component.entry);

            await mkdir(dirname(entry), { recursive: true });
            await writeFile(entry, content);
        }

        await writeFile(join(root, kind, 'current.json'), JSON.stringify({ current: id }));

        return folder;
    }

    function loading(): LanguageInstaller {
        return new LanguageInstaller({ root, runtime, run: async () => 1, onChange: () => undefined });
    }

    async function isLink(folder: string): Promise<boolean> {
        return (await lstat(join(folder, 'node_modules'))).isSymbolicLink();
    }

    const sets = async (): Promise<string[]> => (await readdir(join(root, 'packages')).catch(() => [] as string[])).filter((name) => !name.startsWith('.'));

    it('moves the packages of the first install into a set and links to it', async () => {
        const folder = await standalone('css', 'old');
        const installer = loading();

        await installer.load();

        const [setId] = await sets();
        const set = join(root, 'packages', setId!);

        expect(await isLink(folder)).toBe(true);
        expect(await installer.state('css')).toBe('installed');
        expect(await readFile(join(set, 'node_modules', KIND_PROFILES.css.components[0]!.entry), 'utf8')).toBe('');
        expect(JSON.parse(await readFile(join(set, 'package.json'), 'utf8')).name).toBe('ruimte-language-packages');
        expect(await readFile(join(set, 'bun.lock'), 'utf8')).toContain('ruimte-language-packages');
        expect(await readFile(join(set, 'bun.lock'), 'utf8')).not.toContain('server-css');
        expect(JSON.parse(await readFile(join(set, 'set.json'), 'utf8'))).toMatchObject({ format: 1, files: expect.any(Number) });
        expect(await readdir(join(root, 'packages', '.journal'))).toEqual([]);
        expect(logTexts(installer, 'css').at(-1)).toMatch(/^Shared the packages of 1 installs in \d+ ms$/);
    });

    it('replaces an identical second install with a link and keeps a different one', async () => {
        const css = await standalone('css', 'old');
        const html = await standalone('html', 'old');
        const json = await standalone('json', 'old', 'changed');

        await loading().load();

        expect(await sets()).toHaveLength(1);
        expect(await isLink(css)).toBe(true);
        expect(await isLink(html)).toBe(true);
        expect(await isLink(json)).toBe(false);
        expect(await readdir(join(html))).not.toContain('node_modules.adopting');
        expect(await readFile(join(json, 'node_modules', KIND_PROFILES.json.components[0]!.entry), 'utf8')).toBe('changed');
    });

    it('leaves an install of the retired kind `php` as it is, with the set it links to', async () => {
        const folder = join(root, 'php', 'versions', 'old');
        const setId = 'intelephense-set';

        await mkdir(join(root, 'packages', setId, 'node_modules'), { recursive: true });
        await mkdir(folder, { recursive: true });
        await symlink(join('..', '..', '..', 'packages', setId, 'node_modules'), join(folder, 'node_modules'));
        await writeFile(join(root, 'php', 'current.json'), JSON.stringify({ current: 'old' }));

        const installer = new LanguageInstaller({ root, runtime, run: installing('yaml'), onChange: () => undefined });

        await installer.load();
        await installer.install('yaml');

        expect(await isLink(folder)).toBe(true);
        expect(await sets()).toContain(setId);
        expect(await readFile(join(root, 'php', 'current.json'), 'utf8')).toBe(JSON.stringify({ current: 'old' }));
    });

    it('costs nothing on a later start', async () => {
        await standalone('css', 'old');
        await loading().load();

        const installer = loading();

        await installer.load();

        expect(logTexts(installer, 'css')).toEqual([]);
    });

    it('starts the move over when it stopped before the packages left the install', async () => {
        const folder = await standalone('css', 'old');
        const setId = new PackageStore({ root, runtime, run: async () => 1, now: () => 0 }).setIdOf(pinnedVersionsOf('css'));

        await mkdir(join(root, 'packages', setId), { recursive: true });
        await mkdir(join(root, 'packages', '.journal'), { recursive: true });
        await writeFile(join(root, 'packages', '.journal', `${setId}.json`), JSON.stringify({ from: join('css', 'versions', 'old') }));
        await loading().load();

        expect(await isLink(folder)).toBe(true);
        expect(await sets()).toEqual([setId]);
        expect(await readdir(join(root, 'packages', '.journal'))).toEqual([]);
    });

    it('finishes the move when it stopped after the packages left the install', async () => {
        const folder = await standalone('css', 'old');
        const setId = new PackageStore({ root, runtime, run: async () => 1, now: () => 0 }).setIdOf(pinnedVersionsOf('css'));

        await mkdir(join(root, 'packages', setId), { recursive: true });
        await rename(join(folder, 'node_modules'), join(root, 'packages', setId, 'node_modules'));
        await mkdir(join(root, 'packages', '.journal'), { recursive: true });
        await writeFile(join(root, 'packages', '.journal', `${setId}.json`), JSON.stringify({ from: join('css', 'versions', 'old') }));

        const installer = loading();

        await installer.load();

        expect(await isLink(folder)).toBe(true);
        expect(await installer.state('css')).toBe('installed');
        expect(await readdir(join(root, 'packages', setId))).toContain('set.json');
        expect(await readdir(join(root, 'packages', '.journal'))).toEqual([]);
    });

    it('links an install whose packages were set aside when it stopped', async () => {
        const css = await standalone('css', 'old');
        const html = await standalone('html', 'old');

        await loading().load();
        await rm(join(html, 'node_modules'));
        await mkdir(join(html, 'node_modules.adopting', 'x'), { recursive: true });
        await loading().load();

        expect(await isLink(css)).toBe(true);
        expect(await isLink(html)).toBe(true);
        expect(await readdir(html)).not.toContain('node_modules.adopting');
    });
});
