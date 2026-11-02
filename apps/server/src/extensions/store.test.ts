import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { EXTENSION_API_VERSION } from '@ruimte/contracts';
import { ExtensionStore } from './store.ts';

const root = mkdtempSync(join(tmpdir(), 'ruimte-extension-store-'));
const IDS = Array.from({ length: 8 }, (_, index) => `acme.probe${index}`);

afterAll(() => rmSync(root, { recursive: true, force: true }));

function manifestOf(id: string): string {
    return JSON.stringify({ id, name: id, version: '0.1.0', api: EXTENSION_API_VERSION });
}

function packOf(id: string): string {
    const files = { 'manifest.json': Buffer.from(manifestOf(id)).toString('base64') };

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
});
