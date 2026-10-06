import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    fetchStubs,
    installRelease,
    NativePolicy,
    nativeStubsOf,
    phpLanguageServerCheckout,
    readNativeCheckout,
    type Download,
    type NativeAsset,
    type NativeRelease
} from './native.ts';
import descriptor from './php-native-release.json' with { type: 'json' };
import { sha256, tarGz, zip } from './test-archives.ts';

let folder = '';

beforeEach(async () => {
    folder = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-native-')));
});

afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
});

const COMMIT = 'a'.repeat(40);

async function checkoutAt(path: string, version = '0.3.1'): Promise<void> {
    await mkdir(join(path, 'crates', 'index', 'src'), { recursive: true });
    await writeFile(join(path, 'Cargo.toml'), `[workspace]\nmembers = ["crates/index"]\n\n[workspace.package]\nversion = "${version}"\nedition = "2024"\n`);
    await writeFile(join(path, 'crates', 'index', 'src', 'stubs.rs'), `pub const STUBS_COMMIT: &str = "${COMMIT}";\n`);
}

/* A download that answers from memory, by address. */
function serving(files: Record<string, Uint8Array>, requested: string[] = []): Download {
    return async (url, destination) => {
        requested.push(url);
        const bytes = files[url];
        if (bytes === undefined) {
            throw new Error(`${url} answered 404`);
        }
        await writeFile(destination, bytes);
    };
}

describe('native checkout', () => {
    it('reads the version and the stubs commit from the sources of the server', async () => {
        await checkoutAt(folder);
        expect(readNativeCheckout(folder)).toEqual({ folder, version: '0.3.1', stubsCommit: COMMIT });
        expect(phpLanguageServerCheckout(false, folder)).toEqual({ folder, version: '0.3.1', stubsCommit: COMMIT });
        expect(phpLanguageServerCheckout(true, folder)).toBeNull();
    });

    it('is nothing for a folder that is not the checkout', async () => {
        expect(readNativeCheckout(folder)).toBeNull();
        await writeFile(join(folder, 'Cargo.toml'), '[workspace.package]\nversion = "1.0.0"\n');
        expect(readNativeCheckout(folder)).toBeNull();
    });

    it('finds the standalone sibling from Ruimte sources independently of the working directory', async () => {
        const ruimte = join(folder, 'ruimte');
        const source = join(folder, 'language-servers', 'php');
        await mkdir(ruimte);
        await checkoutAt(source);
        expect(phpLanguageServerCheckout(false, null, ruimte)).toEqual({ folder: source, version: '0.3.1', stubsCommit: COMMIT });
        expect(phpLanguageServerCheckout(true, null, ruimte)).toBeNull();
    });

    it('gives an explicit override priority and does not substitute another checkout when it is invalid', async () => {
        const ruimte = join(folder, 'ruimte');
        const override = join(folder, 'custom-php');
        await mkdir(ruimte);
        await checkoutAt(join(folder, 'language-servers', 'php'));
        await checkoutAt(override, '0.4.0');
        expect(phpLanguageServerCheckout(false, override, ruimte)).toEqual({ folder: override, version: '0.4.0', stubsCommit: COMMIT });
        expect(phpLanguageServerCheckout(false, join(folder, 'missing'), ruimte)).toBeNull();
    });

    it('reads the environment override and ignores it in a compiled daemon', async () => {
        const previous = process.env.RUIMTE_PHP_LANGUAGE_SERVER_SOURCE;
        await checkoutAt(folder);
        try {
            process.env.RUIMTE_PHP_LANGUAGE_SERVER_SOURCE = folder;
            expect(phpLanguageServerCheckout(false)).toEqual({ folder, version: '0.3.1', stubsCommit: COMMIT });
            expect(phpLanguageServerCheckout(true)).toBeNull();
        } finally {
            if (previous === undefined) {
                delete process.env.RUIMTE_PHP_LANGUAGE_SERVER_SOURCE;
            } else {
                process.env.RUIMTE_PHP_LANGUAGE_SERVER_SOURCE = previous;
            }
        }
    });

    it('resolves a symlink to Ruimte before looking for its sibling', async () => {
        const ruimte = join(folder, 'projects', 'ruimte');
        const alias = join(folder, 'alias');
        const source = join(folder, 'projects', 'language-servers', 'php');
        await mkdir(ruimte, { recursive: true });
        await checkoutAt(source);
        await symlink(ruimte, alias, 'dir');
        expect(phpLanguageServerCheckout(false, null, alias)?.folder).toBe(source);
    });

    it('finds a sibling of the primary checkout from a Ruimte worktree without changing Git metadata', async () => {
        const ruimte = join(folder, 'projects', 'ruimte');
        const worktree = join(folder, 'worktrees', 'feature');
        const gitdir = join(ruimte, '.git', 'worktrees', 'feature');
        const source = join(folder, 'projects', 'language-servers', 'php');
        await mkdir(gitdir, { recursive: true });
        await mkdir(worktree, { recursive: true });
        await writeFile(join(worktree, '.git'), 'gitdir: ../../projects/ruimte/.git/worktrees/feature\n');
        await writeFile(join(gitdir, 'commondir'), '../..\n');
        await checkoutAt(source);
        expect(phpLanguageServerCheckout(false, null, worktree)?.folder).toBe(source);
        expect(await readFile(join(worktree, '.git'), 'utf8')).toBe('gitdir: ../../projects/ruimte/.git/worktrees/feature\n');
        expect(await readFile(join(gitdir, 'commondir'), 'utf8')).toBe('../..\n');
        const nearer = join(folder, 'worktrees', 'language-servers', 'php');
        await checkoutAt(nearer);
        expect(phpLanguageServerCheckout(false, null, worktree)?.folder).toBe(nearer);
    });

    it('returns null for absent or malformed standalone sources without creating a checkout', async () => {
        const ruimte = join(folder, 'ruimte');
        await mkdir(ruimte);
        expect(phpLanguageServerCheckout(false, null, ruimte)).toBeNull();
        await expect(stat(join(folder, 'language-servers', 'php'))).rejects.toThrow();
        await writeFile(join(ruimte, '.git'), 'gitdir: missing\n');
        expect(phpLanguageServerCheckout(false, null, ruimte)).toBeNull();
        await checkoutAt(join(folder, 'language-servers', 'php'));
        await writeFile(join(folder, 'language-servers', 'php', 'crates', 'index', 'src', 'stubs.rs'), 'pub const STUBS_COMMIT: &str = "invalid";');
        expect(phpLanguageServerCheckout(false, null, ruimte)).toBeNull();
    });
});

describe('native policy', () => {
    const release: NativeRelease = {
        version: '1.2.3',
        sourceRevision: COMMIT,
        stubsCommit: COMMIT,
        assets: { 'darwin-arm64': { url: 'https://example.test/a.tar.gz', sha256: 'f'.repeat(64), format: 'tar.gz', executable: 'php-language-server' } }
    };

    it('pins the standalone v0.4.1 artifacts and their native version', () => {
        expect(descriptor.version).toBe('0.4.1');
        expect(descriptor.stubsCommit).toBe('e4f5f6c3de39f3bab3e9f3fca4b8cdb8b061e681');
        expect(descriptor.sourceRevision).toBe('a75bafe6a276803b56c9794fb994c90359cb0983');
        expect(descriptor).not.toHaveProperty('adecoreVersion');
        expect(Object.keys(descriptor.assets).sort()).toEqual(['darwin-arm64', 'linux-arm64', 'linux-x64', 'win32-x64']);
        for (const [target, asset] of Object.entries(descriptor.assets)) {
            const [platform, arch] = target.split('-');
            const plan = new NativePolicy({ checkout: null, platform: platform as NodeJS.Platform, arch }).plan('php-native', folder);
            expect(plan).toMatchObject({ source: 'release', version: descriptor.version, asset });
            expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
            expect(asset.url).toBe(
                `https://github.com/basmilius/language-server-php/releases/download/v${descriptor.version}/php-language-server-v${descriptor.version}-${target}.${asset.format}`
            );
        }
    });

    it('runs the checkout the daemon is in, whatever a release says', () => {
        const policy = new NativePolicy({
            checkout: { folder: '/checkout/php-language-server', version: '0.1.0', stubsCommit: COMMIT },
            releases: { 'php-native': release }
        });
        expect(policy.plan('php-native', '/home/php-native')).toEqual({
            source: 'dev',
            version: '0.1.0',
            stubsCommit: COMMIT,
            executable: '/checkout/php-language-server/target/release/php-language-server',
            checkout: '/checkout/php-language-server'
        });
    });

    it('takes the pinned release for the platform of a compiled daemon', () => {
        const policy = new NativePolicy({ checkout: null, platform: 'darwin', arch: 'arm64', releases: { 'php-native': release } });
        expect(policy.plan('php-native', '/home/php-native')).toMatchObject({
            source: 'release',
            version: '1.2.3',
            executable: '/home/php-native/bin/php-language-server',
            asset: release.assets['darwin-arm64']
        });
    });

    it('keeps the version of a release that has no build for this machine, without an asset', () => {
        const policy = new NativePolicy({ checkout: null, platform: 'linux', arch: 'x64', releases: { 'php-native': release } });
        expect(policy.plan('php-native', '/home/php-native')).toMatchObject({ source: 'release', version: '1.2.3' });
        expect(policy.plan('php-native', '/home/php-native')?.asset).toBeUndefined();
    });

    it('has nothing to install in a release build with no release pinned', () => {
        expect(new NativePolicy({ checkout: null, releases: {} }).plan('php-native', '/home/php-native')).toBeNull();
    });
});

describe('installing a release', () => {
    const archive = tarGz([{ path: 'php-language-server', text: '#!/bin/sh\n', mode: 0o755 }]);
    const asset = (overrides: Partial<NativeAsset> = {}): NativeAsset => ({
        url: 'https://example.test/server.tar.gz',
        sha256: sha256(archive),
        format: 'tar.gz',
        executable: 'php-language-server',
        ...overrides
    });

    it('unpacks the archive into bin and leaves the executable runnable', async () => {
        const lines: string[] = [];
        await installRelease(asset(), folder, serving({ 'https://example.test/server.tar.gz': archive }), (line) => lines.push(line));
        expect((await stat(join(folder, 'bin', 'php-language-server'))).mode & 0o111).not.toBe(0);
        expect(lines).toContain('Checksum matches');
    });

    it('unpacks a zip too', async () => {
        const bytes = zip([{ path: 'php-language-server', text: 'x', mode: 0o755 }]);
        await installRelease(
            asset({ format: 'zip', sha256: sha256(bytes) }),
            folder,
            serving({ 'https://example.test/server.tar.gz': bytes }),
            () => undefined
        );
        expect(await readFile(join(folder, 'bin', 'php-language-server'), 'utf8')).toBe('x');
    });

    it('refuses a download that does not match its checksum and unpacks none of it', async () => {
        await expect(
            installRelease(asset({ sha256: '0'.repeat(64) }), folder, serving({ 'https://example.test/server.tar.gz': archive }), () => undefined)
        ).rejects.toThrow('does not match its checksum');
        await expect(stat(join(folder, 'bin'))).rejects.toThrow();
    });

    it('refuses a release that holds no executable', async () => {
        await expect(
            installRelease(asset({ executable: 'missing' }), folder, serving({ 'https://example.test/server.tar.gz': archive }), () => undefined)
        ).rejects.toThrow('holds no missing');
    });

    it('fails with the address when the download does', async () => {
        await expect(installRelease(asset(), folder, serving({}), () => undefined)).rejects.toThrow('404');
    });
});

describe('fetching the stubs', () => {
    const url = `https://codeload.github.com/JetBrains/phpstorm-stubs/tar.gz/${COMMIT}`;
    const stubs = tarGz([
        { path: `phpstorm-stubs-${COMMIT}/standard/standard_0.php`, text: '<?php' },
        { path: `phpstorm-stubs-${COMMIT}/LICENSE`, text: 'Apache' },
        { path: `phpstorm-stubs-${COMMIT}/tests/Foo.txt`, text: 'skipped' }
    ]);

    it('puts the php files and the license where the server reads them, and marks the folder whole', async () => {
        await fetchStubs(folder, COMMIT, serving({ [url]: stubs }), () => undefined);
        const target = nativeStubsOf(folder, COMMIT);
        expect(await readFile(join(target, 'standard', 'standard_0.php'), 'utf8')).toBe('<?php');
        expect(await readFile(join(target, 'LICENSE'), 'utf8')).toBe('Apache');
        expect(await readFile(join(target, '.commit'), 'utf8')).toBe(COMMIT);
        await stat(join(target, '.complete'));
        await expect(stat(join(target, 'tests'))).rejects.toThrow();
    });

    it('downloads nothing when the folder is whole already', async () => {
        const requested: string[] = [];
        await fetchStubs(folder, COMMIT, serving({ [url]: stubs }, requested), () => undefined);
        await fetchStubs(folder, COMMIT, serving({ [url]: stubs }, requested), () => undefined);
        expect(requested).toEqual([url]);
    });

    it('leaves no complete folder behind when the download fails, and starts over after it', async () => {
        await expect(fetchStubs(folder, COMMIT, serving({}), () => undefined)).rejects.toThrow('404');
        await expect(stat(join(nativeStubsOf(folder, COMMIT), '.complete'))).rejects.toThrow();
        await fetchStubs(folder, COMMIT, serving({ [url]: stubs }), () => undefined);
        await stat(join(nativeStubsOf(folder, COMMIT), '.complete'));
    });
});
