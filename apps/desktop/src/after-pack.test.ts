import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

interface PackContext {
    appOutDir: string;
    electronPlatformName: string;
    packager: { appInfo: { productFilename: string } };
}

const require = createRequire(import.meta.url);
const afterPack = require('../build/after-pack.cjs') as (context: PackContext) => Promise<void>;
const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

const fixture = (platform: 'darwin' | 'linux'): PackContext => {
    const appOutDir = mkdtempSync(join(tmpdir(), 'ruimte-after-pack-'));
    roots.push(appOutDir);
    const resources = platform === 'darwin' ? join(appOutDir, 'Ruimte.app', 'Contents', 'Resources') : join(appOutDir, 'resources');
    const files = ['ruimte', 'ruimte-context', 'ruimte.build', 'ruimte.bundle.json'];
    if (platform === 'darwin') {
        files.push('ruimte-simulator-helper', 'native/serve-sim-ax-settings', 'native/serve-sim-native.node');
    }
    for (const name of files) {
        const path = join(resources, 'bin', name);
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, name);
    }
    mkdirSync(join(resources, 'client'), { recursive: true });
    writeFileSync(join(resources, 'client', 'index.html'), '<!doctype html>');
    return { appOutDir, electronPlatformName: platform, packager: { appInfo: { productFilename: 'Ruimte' } } };
};

describe('desktop native bundle check', () => {
    test('accepts a complete macOS bundle', async () => {
        await expect(afterPack(fixture('darwin'))).resolves.toBeUndefined();
    });

    test('names the missing native artifact', async () => {
        const context = fixture('darwin');
        rmSync(join(context.appOutDir, 'Ruimte.app', 'Contents', 'Resources', 'bin', 'ruimte.bundle.json'));
        await expect(afterPack(context)).rejects.toThrow('ruimte.bundle.json');
    });
});
