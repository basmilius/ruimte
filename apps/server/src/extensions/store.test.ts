import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { EXTENSION_API_VERSION, EXTENSION_PACK_MAX_UNPACKED_BYTES } from '@ruimte/contracts';
import { ExtensionHost } from './extension-host.ts';
import { ExtensionStore, isDamaged } from './store.ts';

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
    return (await store.list()).map((extension) => (isDamaged(extension) ? extension.id : extension.manifest.id)).sort();
}

describe('ExtensionStore', () => {
    test('keeps every extension of installs that run at once, and every removal', async () => {
        const store = new ExtensionStore(join(root, 'installs'));

        await Promise.all(IDS.map((id) => store.install(packOf(id))));

        expect(await idsIn(store)).toEqual(IDS);

        await Promise.all(IDS.slice(0, 4).map((id) => store.remove(id)));

        expect(await idsIn(store)).toEqual(IDS.slice(4));
    });

    test('refuses an install or a link that asks for a permission this Ruimte does not know, and keeps nothing of it', async () => {
        const store = new ExtensionStore(join(root, 'unknown-permission'));
        const manifest = JSON.stringify({ id: 'acme.typo', name: 'Typo', version: '0.1.0', api: EXTENSION_API_VERSION, permissions: { 'chat.send': 'Sends' } });
        const folder = join(root, 'projects', 'acme.typo');
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, 'manifest.json'), manifest);

        await expect(
            store.install(gzipSync(JSON.stringify({ files: { 'manifest.json': Buffer.from(manifest).toString('base64') } })).toString('base64'))
        ).rejects.toMatchObject({ code: 'pack-manifest', message: expect.stringContaining('chat.send is not a permission') });
        await expect(store.link(folder)).rejects.toMatchObject({ code: 'pack-manifest' });
        expect(await idsIn(store)).toEqual([]);
    });

    test('refuses an install or a link of another API version, naming this machine, and keeps nothing of it', async () => {
        const store = new ExtensionStore(join(root, 'other-api'));
        const manifest = JSON.stringify({ id: 'acme.future', name: 'Future', version: '0.1.0', api: EXTENSION_API_VERSION + 1 });
        const folder = join(root, 'projects', 'acme.future');
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, 'manifest.json'), manifest);
        const refusal = { code: 'pack-api', message: `acme.future needs API ${EXTENSION_API_VERSION + 1}; this machine has ${EXTENSION_API_VERSION}` };

        await expect(
            store.install(gzipSync(JSON.stringify({ files: { 'manifest.json': Buffer.from(manifest).toString('base64') } })).toString('base64'))
        ).rejects.toMatchObject(refusal);
        await expect(store.link(folder)).rejects.toMatchObject(refusal);
        expect(await idsIn(store)).toEqual([]);
    });

    // On a file system that ignores case the later file would land on the manifest that was checked.
    test('refuses a pack that names one file twice in another case, and keeps nothing of it', async () => {
        const store = new ExtensionStore(join(root, 'case-clash'));
        const files = {
            'manifest.json': Buffer.from(manifestOf('acme.clash')).toString('base64'),
            'MANIFEST.json': Buffer.from(manifestOf('acme.other')).toString('base64')
        };

        await expect(store.install(gzipSync(JSON.stringify({ files })).toString('base64'))).rejects.toMatchObject({ code: 'pack-path' });
        expect(await idsIn(store)).toEqual([]);
    });

    test('refuses a valid pack that unpacks past the limit, and keeps nothing of it', async () => {
        const store = new ExtensionStore(join(root, 'too-large'));
        const manifest = Buffer.from(manifestOf('acme.large')).toString('base64');
        const json = Buffer.concat([
            Buffer.from(`{"files":{"manifest.json":"${manifest}","assets/filler.txt":"`),
            Buffer.alloc(EXTENSION_PACK_MAX_UNPACKED_BYTES, 'A'),
            Buffer.from('"}}')
        ]);

        await expect(store.install(gzipSync(json).toString('base64'))).rejects.toMatchObject({
            code: 'pack-unreadable',
            message: 'This pack unpacks to more than an extension may hold'
        });
        expect(await idsIn(store)).toEqual([]);
    });

    // U+017F folds to s on APFS but not under `toLowerCase`, so only the count after unpacking sees it.
    test.skipIf(process.platform !== 'darwin')(
        'refuses a pack whose file lands on the checked manifest under another folding, and keeps nothing of it',
        async () => {
            const store = new ExtensionStore(join(root, 'folding'));
            const swapped = JSON.stringify({ ...JSON.parse(manifestOf('acme.folded')), permissions: { 'net:evil.example': 'x' } });
            const files = {
                'manifest.json': Buffer.from(manifestOf('acme.folded')).toString('base64'),
                'manifeſt.json': Buffer.from(swapped).toString('base64')
            };

            await expect(store.install(gzipSync(JSON.stringify({ files })).toString('base64'))).rejects.toMatchObject({ code: 'pack-path' });
            expect(await idsIn(store)).toEqual([]);
            expect(await store.get('acme.folded')).toBeNull();
        }
    );

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

    test('refuses to install over a current version it cannot read, and keeps it as it was', async () => {
        const home = join(root, 'damaged-current');
        const store = new ExtensionStore(home);
        const id = 'acme.current';
        const current = join(home, 'extensions', id, 'current.json');

        await store.install(packOf(id));
        writeFileSync(current, '{ "hash": ');

        await expect(store.install(packOf(id, '0.2.0'))).rejects.toMatchObject({ code: 'store-damaged' });
        await expect(store.setEnabled(id, false)).rejects.toMatchObject({ code: 'store-damaged' });
        await expect(store.get(id)).rejects.toMatchObject({ code: 'store-damaged' });
        expect(readFileSync(current, 'utf8')).toBe('{ "hash": ');
    });

    test('lists the others beside one it cannot read, which a person sees with why, can remove, and which never runs', async () => {
        const home = join(root, 'damaged-list');
        const store = new ExtensionStore(home);
        const host = new ExtensionHost({ store });

        await store.install(packOf('acme.kept'));
        await store.install(packOf('acme.broken'));
        writeFileSync(join(home, 'extensions', 'acme.broken', 'versions', (await store.get('acme.broken'))?.hash ?? '', 'manifest.json'), '{ "id": ');

        expect(await idsIn(store)).toEqual(['acme.broken', 'acme.kept']);
        expect(await host.list()).toMatchObject([
            { manifest: { id: 'acme.kept' }, enabled: true },
            { manifest: { id: 'acme.broken', name: 'acme.broken' }, enabled: false, status: 'disabled', error: expect.stringContaining('manifest.json') }
        ]);
        await expect(host.call('acme.broken', 'ping', [])).rejects.toMatchObject({ code: 'store-damaged' });

        await host.remove('acme.broken');

        expect(await idsIn(store)).toEqual(['acme.kept']);
    });

    test('keeps every saved language server at a start with the machine while what is installed cannot be read', async () => {
        const home = join(root, 'unreadable-start');
        const store = new ExtensionStore(home);
        const removed: string[] = [];
        const hostOf = (owners: string[]): ExtensionHost =>
            new ExtensionHost({ store, languageServerOwners: () => owners, removeLanguageServers: async (id) => void removed.push(id) });

        await store.install(packOf('acme.broken'));
        writeFileSync(join(home, 'extensions', 'acme.broken', 'versions', (await store.get('acme.broken'))?.hash ?? '', 'manifest.json'), '{ "id": ');
        await hostOf(['acme.broken', 'acme.gone']).startAutostarted();

        expect(removed).toEqual(['acme.gone']);

        removed.length = 0;
        writeFileSync(join(home, 'extensions', 'installed.json'), '["acme.broken", ');
        await hostOf(['acme.broken', 'acme.gone']).startAutostarted();

        expect(removed).toEqual([]);
    });

    test('unlinks a dev link only for the run that set it last', async () => {
        const store = new ExtensionStore(join(root, 'owned-links'));
        const first = join(root, 'projects', 'owned-first');
        const second = join(root, 'projects', 'owned-second');
        const id = 'acme.owned';

        for (const folder of [first, second]) {
            mkdirSync(folder, { recursive: true });
            writeFileSync(join(folder, 'manifest.json'), manifestOf(id));
        }

        await store.link(first, 'run-a');
        await store.link(second, 'run-b');

        expect(await store.unlink(id, 'run-a')).toBe(false);
        expect((await store.get(id))?.devFolder).toBe(second);
        expect(await store.unlink(id, 'run-b')).toBe(true);
        expect(await store.get(id)).toBeNull();
    });

    test('keeps who owns a dev link over a restart of the machine, and unlinks only for exactly that run', async () => {
        const home = join(root, 'owned-restart');
        const first = join(root, 'projects', 'restart-first');
        const second = join(root, 'projects', 'restart-second');
        const id = 'acme.restarted';

        for (const folder of [first, second]) {
            mkdirSync(folder, { recursive: true });
            writeFileSync(join(folder, 'manifest.json'), manifestOf(id));
        }

        const before = new ExtensionStore(home);

        await before.link(first, 'run-a');
        await before.link(second, 'run-b');

        const after = new ExtensionStore(home);

        expect(await after.unlink(id, 'run-a')).toBe(false);
        expect((await after.get(id))?.devFolder).toBe(second);
        expect(await after.unlink(id, 'run-b')).toBe(true);
        expect(await after.get(id)).toBeNull();

        await after.link(first);

        expect(await new ExtensionStore(home).unlink(id, 'run-b')).toBe(false);
        expect((await after.get(id))?.devFolder).toBe(first);
    });

    // Each write of the file a link makes fails in turn, until a link makes no write of it that fails and lands.
    test.each([
        ['another folder', 'dev-link-owners.json', 1],
        ['another folder', 'dev-links.json', 1],
        ['the same folder', 'dev-link-owners.json', 1],
        ['the same folder', 'dev-links.json', 0]
    ] as const)('a link from %s whose write of %s fails changes nothing, tells no client, and stays the run of before', async (from, file, failingWrites) => {
        const first = join(root, 'projects', `failed-first-${from}-${file}`);
        const second = from === 'the same folder' ? first : join(root, 'projects', `failed-second-${from}-${file}`);
        const id = 'acme.failed';

        for (const folder of [first, second]) {
            mkdirSync(folder, { recursive: true });
            writeFileSync(join(folder, 'manifest.json'), manifestOf(id));
        }

        for (let failing = 1; ; failing++) {
            const home = join(root, `failed-${from}-${file}-${failing}`);
            let writes: number | null = null;
            const store = new ExtensionStore(home, async (path, text) => {
                if (writes !== null && basename(path) === file && ++writes === failing) {
                    throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
                }

                await writeFile(path, text);
            });
            const host = new ExtensionHost({ store });
            const heard: unknown[] = [];

            await host.linked(first, 'run-a');
            host.subscribe('client-a', (event) => void heard.push(event));
            writes = 0;

            const failure = await host.linked(second, 'run-b').then(
                () => null,
                (e: unknown) => e
            );

            writes = null;

            if (failure === null) {
                expect(failing - 1).toBe(failingWrites);
                expect((await store.get(id))?.devFolder).toBe(second);
                expect(await store.unlink(id, 'run-b')).toBe(true);

                break;
            }

            expect(failure).toMatchObject({ code: 'ENOSPC' });
            expect((await new ExtensionStore(home).get(id))?.devFolder).toBe(first);
            expect(heard).toEqual([]);

            await host.unlink(id, 'run-b');

            expect((await store.get(id))?.devFolder).toBe(first);

            await host.unlink(id, 'run-a');

            expect(await store.get(id)).toBeNull();
            expect(heard).toEqual([{ event: 'extension.changed', payload: {} }]);
        }
    });

    test('reads owners in the shape of one token per extension as links no run owns, which a link takes over and a person unlinks or removes', async () => {
        const home = join(root, 'owners-token-shape');
        const ownersFile = join(home, 'extensions', 'dev-link-owners.json');
        const ids = ['acme.removed', 'acme.taken', 'acme.unlinked'];
        const folderOf = (id: string): string => join(root, 'projects', `token-shape-${id}`);

        for (const id of ids) {
            mkdirSync(folderOf(id), { recursive: true });
            writeFileSync(join(folderOf(id), 'manifest.json'), manifestOf(id));
        }

        const before = new ExtensionStore(home);

        await Promise.all(ids.map((id) => before.link(folderOf(id))));
        writeFileSync(ownersFile, JSON.stringify(Object.fromEntries(ids.map((id) => [id, 'run-old']))));

        const store = new ExtensionStore(home);

        expect(await store.unlink('acme.taken', 'run-old')).toBe(false);
        expect(await idsIn(store)).toEqual(ids);

        await store.link(folderOf('acme.taken'), 'run-new');

        expect(await store.unlink('acme.unlinked')).toBe(true);

        await store.remove('acme.removed');

        expect(await idsIn(store)).toEqual(['acme.taken']);
        expect(await store.unlink('acme.taken', 'run-new')).toBe(true);
        expect(await idsIn(store)).toEqual([]);
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
