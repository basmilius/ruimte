import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import release from './antigravity-acp-release.json' with { type: 'json' };
import { isMachineStatePath } from '../fs/machine-home.ts';
import { sha256, zip } from '../language/test-archives.ts';
import { AcpServerInstall, parseAcpServerRelease, type AcpServerRelease } from './acp-server.ts';

const ARCHIVE = zip([
    { path: 'agy_acp_server.par', text: '#!/bin/sh\n', mode: 0o644 },
    { path: 'localharness_external', text: 'helper', mode: 0o644 }
]);

function pinned(sha: string): AcpServerRelease {
    return parseAcpServerRelease({
        version: '1.4.1',
        assets: {
            'darwin-arm64': { url: 'https://example.test/server.zip', sha256: sha, format: 'zip', executable: 'agy_acp_server.par', args: [] },
            'linux-x64': { url: 'https://example.test/server.zip', sha256: sha, format: 'zip', executable: 'agy_acp_server.par', args: ['--uid='] }
        }
    });
}

let home: string;
let fetched: string[];

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-acp-server-'));
    fetched = [];
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

function server(sha: string, platform: NodeJS.Platform = 'linux', arch = 'x64', bytes: Uint8Array = ARCHIVE): AcpServerInstall {
    return new AcpServerInstall({
        provider: 'antigravity',
        home,
        release: pinned(sha),
        platform,
        arch,
        download: async (url, destination) => {
            fetched.push(url);
            await writeFile(destination, bytes);
        }
    });
}

describe('the pinned release file', () => {
    test('pins one version with a checked archive per platform, the server to start and its arguments', () => {
        const parsed = parseAcpServerRelease(release);
        expect(parsed.version).toBe('1.4.1');
        expect(Object.keys(parsed.assets).sort()).toEqual(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64']);
        expect(parsed.assets['linux-x64']).toMatchObject({ executable: 'agy_acp_server.par', args: ['--uid='] });
        expect(parsed.assets['darwin-arm64']).toMatchObject({ executable: 'agy_acp_server.par', args: [] });
        expect(parsed.assets['win32-x64']).toMatchObject({ executable: 'agy_acp_server.exe', args: [] });
        for (const asset of Object.values(parsed.assets)) {
            expect(asset.url).toStartWith('https://dl.google.com/agy-extensions/releases/');
            expect(asset.url).toContain('-1.4.1-');
        }
    });

    test('a file without a full checksum is refused at load', () => {
        expect(() => pinned('abc')).toThrow();
        expect(() =>
            parseAcpServerRelease({ version: '1.4.1', assets: { 'linux-x64': { url: 'x', sha256: 'a'.repeat(64), format: 'zip', executable: 'x', args: [] } } })
        ).toThrow();
    });
});

describe('installing the server', () => {
    test('nothing runs before a person installs it', () => {
        const install = server(sha256(ARCHIVE));
        expect(install.launch()).toBeNull();
        expect(install.status()).toEqual({ provider: 'antigravity', state: 'missing', version: '1.4.1', installed: null });
        expect(fetched).toEqual([]);
    });

    test('an archive that matches its checksum is unpacked, made runnable and started with its arguments', async () => {
        const install = server(sha256(ARCHIVE));
        expect(await install.install()).toEqual({ provider: 'antigravity', state: 'installed', version: '1.4.1', installed: '1.4.1' });
        const folder = join(home, 'agent-servers', 'antigravity');
        expect(install.launch()).toEqual([join(folder, '1.4.1', 'agy_acp_server.par'), '--uid=']);
        if (process.platform !== 'win32') {
            expect((await stat(join(folder, '1.4.1', 'agy_acp_server.par'))).mode & 0o111).not.toBe(0);
            expect((await stat(join(folder, '1.4.1', 'localharness_external'))).mode & 0o111).not.toBe(0);
        }
        expect((await readdir(folder)).sort()).toEqual(['1.4.1', 'installed.json']);
    });

    test('an archive that does not match is refused before anything of it is unpacked', async () => {
        const install = server('0'.repeat(64));
        const status = await install.install();
        expect(status.state).toBe('failed');
        expect(status.error).toContain('The download is damaged');
        expect(install.launch()).toBeNull();
        expect(await readdir(join(home, 'agent-servers', 'antigravity'))).toEqual([]);
    });

    test('a release without the server program is refused', async () => {
        const other = zip([{ path: 'readme.txt', text: 'no server' }]);
        const status = await server(sha256(other), 'linux', 'x64', other).install();
        expect(status).toMatchObject({ state: 'failed', installed: null });
        expect(status.error).toContain('holds no agy_acp_server.par');
    });

    test('a platform the pin has no build for downloads nothing', async () => {
        const install = server(sha256(ARCHIVE), 'freebsd', 'x64');
        expect((await install.install()).state).toBe('unsupported');
        expect(fetched).toEqual([]);
    });

    test('a second press while one runs shares its download', async () => {
        const install = server(sha256(ARCHIVE));
        await Promise.all([install.install(), install.install()]);
        expect(fetched).toHaveLength(1);
    });

    test('the server sits in a folder of the machine that no client request reaches', () => {
        const folder = join(home, 'agent-servers', 'antigravity', '1.4.1', 'agy_acp_server.par');
        expect(isMachineStatePath({ homes: [home] }, folder)).toBe(true);
        expect(existsSync(folder)).toBe(false);
    });
});
