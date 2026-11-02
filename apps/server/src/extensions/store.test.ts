import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { EXTENSION_API_VERSION } from '@ruimte/contracts';
import { ExtensionStore } from './store.ts';

const root = mkdtempSync(join(tmpdir(), 'ruimte-extension-store-'));
const IDS = Array.from({ length: 8 }, (_, index) => `acme.probe${index}`);

afterAll(() => rmSync(root, { recursive: true, force: true }));

function manifestOf(id: string, version = '0.1.0'): string {
    return JSON.stringify({ id, name: id, version, api: EXTENSION_API_VERSION });
}

function packOf(id: string, version?: string): string {
    const files = { 'manifest.json': Buffer.from(manifestOf(id, version)).toString('base64') };

    return gzipSync(JSON.stringify({ files })).toString('base64');
}

async function idsIn(store: ExtensionStore): Promise<string[]> {
    return (await store.list()).map((extension) => extension.manifest.id).sort();
}

describe('ExtensionStore', () => {
    test('keeps every extension of installs that run at once, and every removal', async () => {
        const store = new ExtensionStore(join(root, 'installs'));

        await Promise.all(IDS.map((id) => store.install(packOf(id))));

        expect(await idsIn(store)).toEqual(IDS);

        await Promise.all(IDS.slice(0, 4).map((id) => store.remove(id)));

        expect(await idsIn(store)).toEqual(IDS.slice(4));
    });

    test('keeps every link of folders linked at once', async () => {
        const store = new ExtensionStore(join(root, 'links'));
        const folders = IDS.map((id) => {
            const folder = join(root, 'projects', id);

            mkdirSync(folder, { recursive: true });
            writeFileSync(join(folder, 'manifest.json'), manifestOf(id));

            return folder;
        });

        await Promise.all(folders.map((folder) => store.link(folder)));

        expect(await idsIn(store)).toEqual(IDS);
    });

    test('refuses to change an index it cannot read, and leaves it as it was', async () => {
        const home = join(root, 'damaged');
        const store = new ExtensionStore(home);
        const folder = join(root, 'projects', 'damaged');

        mkdirSync(join(home, 'extensions'), { recursive: true });
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, 'manifest.json'), manifestOf('acme.damaged'));
        writeFileSync(join(home, 'extensions', 'installed.json'), '["acme.kept", ');
        writeFileSync(join(home, 'extensions', 'dev-links.json'), '{ "acme.linked": 1 }');

        await expect(store.install(packOf('acme.new'))).rejects.toMatchObject({ code: 'store-damaged' });
        await expect(store.remove('acme.kept')).rejects.toMatchObject({ code: 'store-damaged' });
        await expect(store.link(folder)).rejects.toMatchObject({ code: 'store-damaged' });
        expect(readFileSync(join(home, 'extensions', 'installed.json'), 'utf8')).toBe('["acme.kept", ');
        expect(readFileSync(join(home, 'extensions', 'dev-links.json'), 'utf8')).toBe('{ "acme.linked": 1 }');
    });

    test('a removal after an install takes it away, also while the install still unpacks', async () => {
        const store = new ExtensionStore(join(root, 'install-remove'));
        const [id] = IDS as [string];

        await Promise.all([store.install(packOf(id)), store.remove(id)]);

        expect(await store.list()).toEqual([]);
        expect(existsSync(join(root, 'install-remove', 'extensions', id))).toBe(false);
    });

    // Windows keeps a folder writable whatever its mode says, so the write this test makes fail would succeed there.
    test.skipIf(process.platform === 'win32')('keeps the version in use when the index cannot be written', async () => {
        const home = join(root, 'unwritable');
        const store = new ExtensionStore(home);
        const id = 'acme.unwritable';
        const first = await store.install(packOf(id));

        chmodSync(join(home, 'extensions'), 0o555);

        try {
            await expect(store.install(packOf(id, '0.2.0'))).rejects.toThrow();
        } finally {
            chmodSync(join(home, 'extensions'), 0o755);
        }

        expect((await store.get(id))?.hash).toBe(first.hash);
    });

    test('a dev link stays off while a person turned it off, and a removal takes the link with it', async () => {
        const store = new ExtensionStore(join(root, 'linked-off'));
        const folder = join(root, 'projects', 'linked-off');
        const id = 'acme.linkedoff';

        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, 'manifest.json'), manifestOf(id));
        await store.link(folder);
        await store.setEnabled(id, false);
        await store.link(folder);

        expect((await new ExtensionStore(join(root, 'linked-off')).get(id))?.enabled).toBe(false);

        await store.remove(id);

        expect(await store.get(id)).toBeNull();
        expect(await store.list()).toEqual([]);
    });
});
