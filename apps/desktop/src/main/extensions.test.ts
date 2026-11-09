import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { EXTENSION_API_VERSION, EXTENSION_PACK_MAX_UNPACKED_BYTES } from '@ruimte/contracts';
import { ClientExtensions, hostsOf } from './extensions';

const ORIGIN = 'ruimte://app';
let root: string;

function base64(text: string): string {
    return Buffer.from(text).toString('base64');
}

function pack(files: Record<string, string>, permissions: Record<string, string> = { 'net:ci.example.com': 'Reads builds' }): Uint8Array {
    const manifest = JSON.stringify({ id: 'acme.builds', name: 'Builds', version: '1.0.0', api: 1, permissions });

    return gzipSync(
        JSON.stringify({ files: Object.fromEntries(Object.entries({ 'manifest.json': manifest, ...files }).map(([path, text]) => [path, base64(text)])) })
    );
}

function extensions(onChanged?: () => void): ClientExtensions {
    root = mkdtempSync(join(tmpdir(), 'ruimte-extensions-'));

    return new ClientExtensions(root, onChanged);
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

    test('serve a load of a version, its chunks too, under the address of that load', async () => {
        const store = extensions();
        const { base } = await store.install(pack({ 'client/index.js': 'export {};', 'client/chunks/shared.js': 'export const shared = 1;' }));
        const loaded = `${base.slice(0, -1)}~3/`;

        expect(await (await store.answer(`${loaded}client/index.js`, ORIGIN)).text()).toBe('export {};');
        expect(await (await store.answer(`${loaded}client/chunks/shared.js`, ORIGIN)).text()).toBe('export const shared = 1;');
        expect((await store.answer(`${base.slice(0, -1)}~/client/index.js`, ORIGIN)).status).toBe(404);
    });

    test('refuse a pack of another API version by the name a person knows it by', async () => {
        const store = extensions();
        const manifest = JSON.stringify({ id: 'acme.builds', name: 'Builds', version: '1.0.0', api: EXTENSION_API_VERSION + 1 });

        await expect(store.install(gzipSync(JSON.stringify({ files: { 'manifest.json': base64(manifest) } })))).rejects.toThrow(
            'Builds needs a different version of Ruimte'
        );
        expect(await store.list()).toEqual([]);
    });

    test('refuse a pack that asks for a permission this Ruimte does not know, or a net: that is no host', async () => {
        const store = extensions();

        await expect(store.install(pack({ 'client/index.js': 'export {};' }, { 'chat.send': 'Sends' }))).rejects.toThrow('chat.send is not a permission');
        await expect(store.install(pack({ 'client/index.js': 'export {};' }, { 'net:a.com; frame-src https:': 'Calls' }))).rejects.toThrow(
            'does not name a host'
        );
        expect(await store.list()).toEqual([]);
    });

    test("only a host name reaches a frame's policy", () => {
        expect(hostsOf({ permissions: { 'net:ci.example.com': 'Reads', 'net:a.com; frame-src https:': 'Calls', 'files.read': 'Reads' } })).toEqual([
            'https://ci.example.com'
        ]);
    });

    test('refuse a pack with a path outside itself, and leave nothing behind', async () => {
        const store = extensions();

        await expect(store.install(pack({ '../escape.js': 'x' }))).rejects.toThrow('outside itself');
        expect(await store.list()).toEqual([]);
    });

    // On a file system that ignores case the later file would land on the manifest that was checked.
    test('refuse a pack that names one file twice in another case', async () => {
        const store = extensions();
        const swapped = JSON.stringify({ id: 'acme.builds', name: 'Builds', version: '1.0.0', api: 1, permissions: { 'net:evil.example.com': 'Sends' } });

        await expect(store.install(pack({ 'MANIFEST.json': swapped }))).rejects.toThrow('MANIFEST.json twice');
        await expect(store.install(pack({ 'client/a.js': 'x', 'Client/A.js': 'y' }))).rejects.toThrow('twice');
        expect(await store.list()).toEqual([]);
    });

    test('refuse a valid pack that unpacks past the limit', async () => {
        const store = extensions();
        const manifest = base64(JSON.stringify({ id: 'acme.builds', name: 'Builds', version: '1.0.0', api: 1 }));
        const json = Buffer.concat([
            Buffer.from(`{"files":{"manifest.json":"${manifest}","client/filler.txt":"`),
            Buffer.alloc(EXTENSION_PACK_MAX_UNPACKED_BYTES, 'A'),
            Buffer.from('"}}')
        ]);

        await expect(store.install(gzipSync(json))).rejects.toThrow('This pack unpacks to more than an extension may hold');
        expect(await store.list()).toEqual([]);
    });

    // U+017F folds to s on APFS but not under `toLowerCase`, so only the count after unpacking sees it.
    test.skipIf(process.platform !== 'darwin')('refuse a pack whose file lands on the checked manifest under another folding', async () => {
        const store = extensions();
        const swapped = JSON.stringify({ id: 'acme.builds', name: 'Builds', version: '1.0.0', api: 1, permissions: { 'net:evil.example.com': 'Sends' } });

        await expect(store.install(pack({ 'manifeſt.json': swapped }))).rejects.toThrow('treats as the same');
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
        expect(await (await store.answer('/__extensions/acme.dev/dev-1~2/client/index.js', ORIGIN)).text()).toBe('export {};');
        expect((await store.answer('/__extensions/acme.dev/dev-1~2/client/secret.js', ORIGIN)).status).toBe(404);
    });

    test('turn a dev link off through its next builds, and drop it when the extension is removed', async () => {
        const store = extensions();
        const folder = join(root, 'dev');

        mkdirSync(join(folder, 'client'), { recursive: true });
        writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ id: 'acme.dev', name: 'Dev', version: '1.0.0', api: 1 }));
        writeFileSync(join(folder, 'client', 'index.js'), 'export {};');
        await store.link(folder, 1);
        await store.setEnabled('acme.dev', false);
        await store.link(folder, 2);

        const rebuilt = await store.list();

        await store.remove('acme.dev');

        expect(rebuilt.map((entry) => [entry.base, entry.enabled])).toEqual([['/__extensions/acme.dev/dev-2/', false]]);
        expect(await store.list()).toEqual([]);
    });

    test('remove only an id an extension can have, never a path out of its folder', async () => {
        const store = extensions();
        writeFileSync(join(root, 'keep.json'), '{}');

        // `acme/..` names the root itself, so a regression empties only this test's folder.
        expect(() => store.remove('acme/..')).toThrow();
        expect(existsSync(join(root, 'keep.json'))).toBe(true);
    });

    test('link a dev folder that is off as off from the first word to the windows', async () => {
        const seen: Promise<boolean[]>[] = [];
        const store: ClientExtensions = extensions(() => void seen.push(store.list().then((entries) => entries.map((entry) => entry.enabled))));
        const folder = join(root, 'dev');

        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ id: 'acme.dev', name: 'Dev', version: '1.0.0', api: 1 }));

        await store.link(folder, 1, false);
        await store.link(folder, 2);

        expect(await Promise.all(seen)).toEqual([[false], [false]]);
    });

    test('remember which pack came from the store, until one from a file replaces it', async () => {
        const store = extensions();

        expect((await store.install(pack({}), true)).fromStore).toBe(true);
        expect((await store.list())[0]?.fromStore).toBe(true);

        await store.install(pack({ 'client/index.js': 'export {};' }));

        expect((await store.list())[0]?.fromStore).toBeUndefined();
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

    test('refuse to change an index it cannot read, and leave it as it was', async () => {
        const store = extensions();

        writeFileSync(join(root, 'index.json'), '[{ "id": "acme.kept"');

        await expect(store.install(pack({}))).rejects.toThrow();
        await expect(store.setEnabled('acme.kept', false)).rejects.toThrow();
        expect(readFileSync(join(root, 'index.json'), 'utf8')).toBe('[{ "id": "acme.kept"');
    });

    test('a removal after an install takes it away, also while the install still unpacks', async () => {
        const store = extensions();

        await Promise.all([store.install(pack({ 'client/index.js': 'export {};' })), store.remove('acme.builds')]);

        expect(await store.list()).toEqual([]);
        expect(existsSync(join(root, 'acme.builds'))).toBe(false);
    });

    test('a link and an unlink land in the order they were asked', async () => {
        const store = extensions();
        const folder = join(root, 'dev');

        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ id: 'acme.dev', name: 'Dev', version: '1.0.0', api: 1 }));

        await Promise.all([store.link(folder, 1), store.unlink('acme.dev')]);

        expect(await store.list()).toEqual([]);
    });

    test('answer a path that is no valid encoding as a bad request', async () => {
        const store = extensions();

        expect((await store.answer('/__extensions/acme.builds/%ZZ/client/index.js', ORIGIN)).status).toBe(400);
    });

    test('forget an extension that is removed', async () => {
        const store = extensions();
        const { base } = await store.install(pack({ 'client/index.js': 'export {};' }));

        await store.remove('acme.builds');

        expect(await store.list()).toEqual([]);
        expect((await store.answer(`${base}client/index.js`, ORIGIN)).status).toBe(404);
    });

    test('tell every window of each change it made, and of none it did not make', async () => {
        const told: string[] = [];
        const store = extensions(() => void told.push('changed'));
        const folder = join(root, 'dev');

        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ id: 'acme.dev', name: 'Dev', version: '1.0.0', api: 1 }));

        await store.install(pack({ 'client/index.js': 'export {};' }));
        await store.setEnabled('acme.builds', false);
        await store.link(folder, 1);
        await store.unlink('acme.dev');
        await store.unlink('acme.dev');
        await expect(store.link(join(root, 'nothing'), 2)).rejects.toThrow('No valid manifest.json');

        expect(told).toEqual(['changed', 'changed', 'changed', 'changed']);
    });

    test('tell every window of a change before the next one is done', async () => {
        const order: string[] = [];
        const store = extensions(() => void order.push(`told ${order.length}`));
        const installing = store.install(pack({}));
        const turningOff = store.setEnabled('acme.builds', false).then(() => void order.push('second done'));

        await Promise.all([installing, turningOff]);

        expect(order).toEqual(['told 0', 'told 1', 'second done']);
    });

    // Windows keeps a folder writable whatever its mode says, so the write this test makes fail would succeed there.
    test.skipIf(process.platform === 'win32')('change no dev link when the index cannot be written, and tell no window', async () => {
        const told: string[] = [];
        const store = extensions(() => void told.push('changed'));
        const folder = join(root, 'dev');

        mkdirSync(join(folder, 'client'), { recursive: true });
        writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ id: 'acme.dev', name: 'Dev', version: '1.0.0', api: 1 }));
        writeFileSync(join(folder, 'client', 'index.js'), 'export {};');
        await store.install(pack({}));
        await store.link(folder, 1);
        told.length = 0;
        chmodSync(root, 0o555);

        try {
            await expect(store.setEnabled('acme.dev', false)).rejects.toThrow();
            await expect(store.remove('acme.dev')).rejects.toThrow();
        } finally {
            chmodSync(root, 0o755);
        }

        expect(told).toEqual([]);
        expect((await store.list()).map((entry) => [entry.manifest.id, entry.dev, entry.enabled])).toEqual([
            ['acme.builds', false, true],
            ['acme.dev', true, true]
        ]);
    });

    // Windows keeps a folder writable whatever its mode says, so the removal this test makes fail would succeed there.
    test.skipIf(process.platform === 'win32')('tell every window of a removal whose files could not all go', async () => {
        const told: string[] = [];
        const store = extensions(() => void told.push('changed'));

        await store.install(pack({ 'client/index.js': 'export {};' }));
        told.length = 0;
        chmodSync(join(root, 'acme.builds'), 0o555);

        try {
            await expect(store.remove('acme.builds')).rejects.toThrow();
        } finally {
            chmodSync(join(root, 'acme.builds'), 0o755);
        }

        expect(told).toEqual(['changed']);
        expect(await store.list()).toEqual([]);
    });
});
