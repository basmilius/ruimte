import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ClientExtensions } from './extensions';

const ORIGIN = 'ruimte://app';
let root: string;

function base64(text: string): string {
    return Buffer.from(text).toString('base64');
}

function pack(files: Record<string, string>): Uint8Array {
    const manifest = JSON.stringify({ id: 'acme.builds', name: 'Builds', version: '1.0.0', api: 1, permissions: { 'net:ci.example.com': 'Reads builds' } });

    return gzipSync(
        JSON.stringify({ files: Object.fromEntries(Object.entries({ 'manifest.json': manifest, ...files }).map(([path, text]) => [path, base64(text)])) })
    );
}

function extensions(): ClientExtensions {
    root = mkdtempSync(join(tmpdir(), 'ruimte-extensions-'));

    return new ClientExtensions(root);
}

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('the client extensions of the shell', () => {
    test('install a pack and serve its files, a frame under its own policy', async () => {
        const store = extensions();
        const { base } = await store.install(pack({ 'client/index.js': 'export {};', 'views/run.html': '<p>Run</p>' }));
        const script = await store.answer(`${base}client/index.js`, ORIGIN);
        const frame = await store.answer(`${base}views/run.html`, ORIGIN);

        expect(script.headers.get('content-type')).toContain('javascript');
        expect(await script.text()).toBe('export {};');
        expect(frame.headers.get('content-security-policy')).toContain('https://ci.example.com');
        expect((await store.list()).map((entry) => entry.manifest.id)).toEqual(['acme.builds']);
    });

    test('refuse a pack with a path outside itself, and leave nothing behind', async () => {
        const store = extensions();

        await expect(store.install(pack({ '../escape.js': 'x' }))).rejects.toThrow('outside itself');
        expect(await store.list()).toEqual([]);
    });

    test('never serve outside the folder of an extension, or a version it does not have', async () => {
        const store = extensions();
        const { base } = await store.install(pack({ 'client/index.js': 'export {};' }));

        expect((await store.answer(`${base}../../index.json`, ORIGIN)).status).toBe(404);
        expect((await store.answer('/__extensions/acme.builds/other/client/index.js', ORIGIN)).status).toBe(404);
    });

    test('never follow a symlink in a dev folder out of it', async () => {
        const store = extensions();
        const folder = join(root, 'dev');
        const secret = join(root, 'secret.txt');

        mkdirSync(join(folder, 'client'), { recursive: true });
        writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ id: 'acme.dev', name: 'Dev', version: '1.0.0', api: 1 }));
        writeFileSync(join(folder, 'client', 'index.js'), 'export {};');
        writeFileSync(secret, 'secret');
        symlinkSync(secret, join(folder, 'client', 'secret.js'));
        await store.link(folder, 1);

        expect((await store.answer('/__extensions/acme.dev/dev-1/client/secret.js', ORIGIN)).status).toBe(404);
        expect(await (await store.answer('/__extensions/acme.dev/dev-1/client/index.js', ORIGIN)).text()).toBe('export {};');
    });

    test('keep both of two changes to the index made at once', async () => {
        const store = extensions();
        const other = gzipSync(
            JSON.stringify({ files: { 'manifest.json': base64(JSON.stringify({ id: 'acme.other', name: 'Other', version: '1.0.0', api: 1 })) } })
        );

        await store.install(pack({}));
        await store.install(other);
        await Promise.all([store.setEnabled('acme.builds', false), store.setEnabled('acme.other', false)]);

        expect((await store.list()).map((entry) => [entry.manifest.id, entry.enabled])).toEqual([
            ['acme.builds', false],
            ['acme.other', false]
        ]);
    });

    test('forget an extension that is removed', async () => {
        const store = extensions();
        const { base } = await store.install(pack({ 'client/index.js': 'export {};' }));

        await store.remove('acme.builds');

        expect(await store.list()).toEqual([]);
        expect((await store.answer(`${base}client/index.js`, ORIGIN)).status).toBe(404);
    });
});
