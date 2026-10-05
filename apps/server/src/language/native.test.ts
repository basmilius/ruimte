import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchStubs, installRelease, NativePolicy, nativeStubsOf, readNativeCheckout, type Download, type NativeAsset, type NativeRelease } from './native.ts';
import { sha256, tarGz, zip } from './test-archives.ts';

let folder = '';

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'ruimte-native-'));
});

afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
});

const COMMIT = 'a'.repeat(40);

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
        await mkdir(join(folder, 'crates', 'index', 'src'), { recursive: true });
        await writeFile(join(folder, 'Cargo.toml'), '[workspace]\nmembers = ["crates/index"]\n\n[workspace.package]\nversion = "0.3.1"\nedition = "2024"\n');
        await writeFile(join(folder, 'crates', 'index', 'src', 'stubs.rs'), `pub const STUBS_COMMIT: &str = "${COMMIT}";\n`);
        expect(readNativeCheckout(folder)).toEqual({ folder, version: '0.3.1', stubsCommit: COMMIT });
    });

    it('is nothing for a folder that is not the checkout', async () => {
        expect(readNativeCheckout(folder)).toBeNull();
        await writeFile(join(folder, 'Cargo.toml'), '[workspace.package]\nversion = "1.0.0"\n');
        expect(readNativeCheckout(folder)).toBeNull();
    });
});

describe('native policy', () => {
    const release: NativeRelease = {
        version: '1.2.3',
        stubsCommit: COMMIT,
        assets: { 'darwin-arm64': { url: 'https://example.test/a.tar.gz', sha256: 'f'.repeat(64), format: 'tar.gz', executable: 'php-language-server' } }
    };

    it('runs the checkout the daemon is in, whatever a release says', () => {
        const policy = new NativePolicy({
            checkout: { folder: '/repo/apps/php-language-server', version: '0.1.0', stubsCommit: COMMIT },
            releases: { 'php-native': release }
        });
        expect(policy.plan('php-native', '/home/php-native')).toEqual({
            source: 'dev',
            version: '0.1.0',
            stubsCommit: COMMIT,
            executable: '/repo/apps/php-language-server/target/release/php-language-server',
            checkout: '/repo/apps/php-language-server'
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
        expect(new NativePolicy({ checkout: null }).plan('php-native', '/home/php-native')).toBeNull();
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
