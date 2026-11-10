import { describe, expect, test } from 'bun:test';
import { gzipSync, gunzipSync } from 'node:zlib';
import { extensionManifestProblem, readExtensionPack } from './extension-pack.ts';
import { EXTENSION_API_VERSION } from './extension.ts';

const gunzip = (bytes: Uint8Array): Uint8Array => gunzipSync(bytes);

function base64Of(text: string): string {
    return Buffer.from(text).toString('base64');
}

function packOf(files: Record<string, string>): Uint8Array {
    return gzipSync(JSON.stringify({ files }));
}

function manifestOf(extra: Record<string, unknown> = {}): string {
    return base64Of(JSON.stringify({ id: 'acme.pack', name: 'Pack', version: '0.1.0', api: EXTENSION_API_VERSION, ...extra }));
}

describe('a pack read whole', () => {
    test('gives the manifest and the files as the pack holds them', async () => {
        const icon = base64Of('<svg/>');
        const reading = await readExtensionPack(packOf({ 'manifest.json': manifestOf(), 'assets/icon.svg': icon }), gunzip);

        expect(reading).toMatchObject({ ok: true, manifest: { id: 'acme.pack' }, files: { 'assets/icon.svg': icon } });
    });

    test('refuses bytes that are no pack', async () => {
        expect(await readExtensionPack(new TextEncoder().encode('nonsense'), gunzip)).toEqual({
            ok: false,
            code: 'pack-unreadable',
            message: 'This is not an extension pack'
        });
        expect(await readExtensionPack(gzipSync('{"nothing":1}'), gunzip)).toMatchObject({ ok: false, code: 'pack-unreadable' });
    });

    test('refuses a path that leaves its folder', async () => {
        expect(await readExtensionPack(packOf({ 'manifest.json': manifestOf(), '../escape.js': 'eA==' }), gunzip)).toMatchObject({
            ok: false,
            code: 'pack-path',
            message: expect.stringContaining('../escape.js')
        });
    });

    // On a file system that ignores case the later file would land on the manifest that was checked.
    test('refuses a pack that names one file twice in another case', async () => {
        expect(await readExtensionPack(packOf({ 'manifest.json': manifestOf(), 'MANIFEST.json': 'eA==' }), gunzip)).toMatchObject({
            ok: false,
            code: 'pack-path',
            message: expect.stringContaining('MANIFEST.json twice')
        });
    });

    test('refuses a pack without a valid manifest', async () => {
        expect(await readExtensionPack(packOf({ 'client/index.js': 'eA==' }), gunzip)).toMatchObject({ ok: false, code: 'pack-manifest' });
        expect(await readExtensionPack(packOf({ 'manifest.json': base64Of('{"id":') }), gunzip)).toMatchObject({ ok: false, code: 'pack-manifest' });
        expect(await readExtensionPack(packOf({ 'manifest.json': base64Of('{"id":"acme.pack"}') }), gunzip)).toMatchObject({
            ok: false,
            code: 'pack-manifest'
        });
    });

    test('refuses another API version and permissions this Ruimte does not know', async () => {
        expect(await readExtensionPack(packOf({ 'manifest.json': manifestOf({ api: EXTENSION_API_VERSION + 1 }) }), gunzip)).toMatchObject({
            ok: false,
            code: 'pack-api'
        });
        expect(await readExtensionPack(packOf({ 'manifest.json': manifestOf({ permissions: { 'chat.send': 'Sends' } }) }), gunzip)).toMatchObject({
            ok: false,
            code: 'pack-manifest',
            message: expect.stringContaining('chat.send is not a permission')
        });
    });

    test('takes a gunzip that answers later, as a browser does', async () => {
        const reading = await readExtensionPack(packOf({ 'manifest.json': manifestOf() }), async (bytes) => gunzipSync(bytes));

        expect(reading.ok).toBe(true);
    });
});

test('a manifest names itself in what it is refused for', () => {
    const manifest = { id: 'acme.pack', name: 'Pack', version: '0.1.0', api: EXTENSION_API_VERSION + 1 };

    expect(extensionManifestProblem(manifest)?.message).toBe(`acme.pack needs API ${EXTENSION_API_VERSION + 1}; this Ruimte has ${EXTENSION_API_VERSION}`);
    expect(extensionManifestProblem(manifest, { refusesApi: (refused) => `${refused.name} is too new` })?.message).toBe('Pack is too new');
    expect(extensionManifestProblem({ ...manifest, api: EXTENSION_API_VERSION }, { subject: 'manifest.json' })).toBeNull();
});
