import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExtensionHost } from './extension-host.ts';
import { packExtension } from './pack.ts';
import { ExtensionStore } from './store.ts';

const EXTENSIONS = join(import.meta.dir, '../../../../extensions');
// Each by its folder and the id its manifest carries.
const PRODUCTS = ['trackline', 'boardwalk', 'beacon', 'pulseboard'].map((name) => [`dev/${name}`, `dev.${name}`] as const);
const POCS = ['surfaces', 'machine', 'frame', 'themes', 'broken', 'broken-load'].map((name) => [`poc/${name}`, `poc.${name}`] as const);
const TRACKLINE = 'dev.trackline';
const KEY = 'trk_demo1234';
const root = mkdtempSync(join(tmpdir(), 'ruimte-extension-development-'));
const hosts: ExtensionHost[] = [];

function hostIn(name: string): { host: ExtensionHost; home: string } {
    const home = join(root, name);
    const host = new ExtensionHost({ store: new ExtensionStore(home) });

    hosts.push(host);

    return { host, home };
}

async function packOf(folder: string): Promise<string> {
    const { path } = await packExtension(join(EXTENSIONS, folder));

    return readFileSync(path).toString('base64');
}

async function until(condition: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 200 && !condition(); attempt++) {
        await Bun.sleep(10);
    }
}

afterEach(() => hosts.splice(0).forEach((host) => host.stopAll()));
afterAll(() => {
    rmSync(root, { recursive: true, force: true });

    for (const [folder] of [...PRODUCTS, ...POCS, ['dev/harbor']]) {
        rmSync(join(EXTENSIONS, folder, 'dist'), { recursive: true, force: true });
    }
});

describe('the development extensions', () => {
    test.each([...PRODUCTS, ...POCS])('%s packs and installs', async (folder, id) => {
        const { host } = hostIn(`install-${id}`);
        const info = await host.install(await packOf(folder));

        expect(info.manifest.id).toBe(id);
    });

    test('Harbor packs, and installs nowhere while it uses a proposed part, which only a link of it runs', async () => {
        const { host } = hostIn('install-harbor');
        const pack = await packOf('dev/harbor');

        await expect(host.install(pack)).rejects.toThrow(
            'This extension uses a part of Ruimte that is not final yet (terminalProfiles). It works while its author develops it, and an installed extension cannot use it.'
        );
        expect(await host.list()).toEqual([]);

        expect(await host.linked(join(EXTENSIONS, 'dev/harbor', 'dist'))).toBe('dev.harbor');
        expect((await host.list())[0]).toMatchObject({ provenance: 'dev-link', enabled: true });
        expect((await host.list())[0]?.refused).toBeUndefined();
    });

    test('Trackline keeps its key and its chats over a restart, and the key is private', async () => {
        const { host, home } = hostIn('restart');

        await host.install(await packOf('dev/trackline'));

        expect(await host.call(TRACKLINE, 'account', [])).toBeNull();
        expect(await host.call(TRACKLINE, 'connect', [KEY])).toBe('mira');
        await host.call(TRACKLINE, 'assign', ['TRK-101', 'chat-1']);

        await host.setEnabled(TRACKLINE, false);
        await host.setEnabled(TRACKLINE, true);

        expect(await host.call(TRACKLINE, 'account', [])).toBe('mira');
        expect(await host.call(TRACKLINE, 'issues', [])).toMatchObject([{ key: 'TRK-101', chat: 'chat-1', working: false }, {}, {}, {}]);
        expect(statSync(join(new ExtensionStore(home).dataFolder(TRACKLINE), 'secrets.json')).mode & 0o077).toBe(0);
    });

    test('Trackline says something to clients, hears machine events and reads its node for an agent', async () => {
        const { host } = hostIn('events');
        const heard: unknown[] = [];

        host.subscribe('client', (event) => heard.push(event));
        await host.install(await packOf('dev/trackline'));
        await host.call(TRACKLINE, 'connect', [KEY]);
        await host.call(TRACKLINE, 'assign', ['TRK-101', 'chat-1']);

        expect(JSON.stringify(heard)).toContain('issues.changed');

        host.forwardEvent('chat.status', { chatId: 'chat-1', info: { chatId: 'chat-1', provider: 'claude', status: 'running', model: null, cwd: '/work' } });

        // The event goes down the same pipe ahead of this call, so it has been handled by the answer.
        expect(await host.call(TRACKLINE, 'issues', [])).toMatchObject([{ key: 'TRK-101', working: true }, {}, {}, {}]);
        expect(await host.nodeContext(TRACKLINE, 'issue', { key: 'TRK-98' })).toEqual([
            { text: expect.stringContaining('TRK-98: Dates show in the wrong time zone') }
        ]);
    });

    test('Trackline offers an agent a tool, only while it runs', async () => {
        const { host } = hostIn('tools');

        await host.install(await packOf('dev/trackline'));
        await until(() => host.agentTools().length > 0);
        await host.call(TRACKLINE, 'connect', [KEY]);

        expect(host.agentTools().map((tool) => tool.id)).toEqual([`${TRACKLINE}/issue`]);
        expect(await host.runAgentTool(`${TRACKLINE}/issue`, { key: 'TRK-102' }, { caller: 'chat-1' })).toContain('Export a report as a spreadsheet');
        await expect(host.runAgentTool(`${TRACKLINE}/none`, {}, { caller: 'chat-1' })).rejects.toThrow('No tool');

        await host.setEnabled(TRACKLINE, false);

        expect(host.agentTools()).toEqual([]);
    });

    test('Trackline starts a chat through the machine, and an extension without the permission is refused', async () => {
        const started: unknown[] = [];
        const host = new ExtensionHost({
            store: new ExtensionStore(join(root, 'starts')),
            startChat: async (id, start) => {
                started.push({ id, ...start });

                return { nodeId: 'chat-1' };
            }
        });

        hosts.push(host);
        await host.install(await packOf('dev/trackline'));
        await host.install(await packOf('dev/boardwalk'));

        expect(await host.startAgent(TRACKLINE, { projectId: 'project-1', title: 'TRK-101' })).toEqual({ nodeId: 'chat-1' });
        expect(started[0]).toMatchObject({ id: TRACKLINE, projectId: 'project-1', title: 'TRK-101' });
        await expect(host.startAgent('dev.boardwalk', { projectId: 'project-1' })).rejects.toMatchObject({ code: 'permission-denied' });
    });

    test('an action of the machine goes only through the list and the manifest', async () => {
        const ran: string[] = [];
        const host = new ExtensionHost({
            store: new ExtensionStore(join(root, 'actions')),
            runAction: async (_id, _project, action) => void ran.push(action)
        });

        hosts.push(host);
        await host.install(await packOf('dev/beacon'));
        await host.runAction('dev.beacon', 'project', 'browser.inspect', {});

        expect(ran).toEqual(['browser.inspect']);
        await expect(host.runAction('dev.beacon', 'project', 'launch.start', {})).rejects.toMatchObject({ code: 'permission-denied' });
        await expect(host.runAction('dev.beacon', 'project', 'node.delete', {})).rejects.toMatchObject({ code: 'not-found' });
    });

    test('a language server of an extension goes through the manifest, and leaves with the extension', async () => {
        const added: object[] = [];
        const removed: string[] = [];
        const host = new ExtensionHost({
            store: new ExtensionStore(join(root, 'languages')),
            addLanguageServer: async (_id, server) => void added.push(server),
            removeLanguageServers: async (id) => void removed.push(id)
        });

        hosts.push(host);
        await host.install(await packOf('poc/machine'));
        await host.call('poc.machine', 'addServer', []);

        expect(added).toMatchObject([{ name: 'POC language server', command: 'cat' }]);

        // An install takes the servers of what ran before it too.
        removed.length = 0;
        await host.remove('poc.machine');

        expect(removed).toEqual(['poc.machine']);
    });

    test('a client with no shell gets the client part and never the server part', async () => {
        const { host } = hostIn('files');

        await host.install(await packOf('dev/beacon'));

        const { files } = await host.clientFiles('dev.beacon');

        expect(Object.keys(files)).toContain('manifest.json');
        expect(Object.keys(files).some((path) => path.startsWith('client/'))).toBe(true);
        expect(Object.keys(files).some((path) => path.startsWith('server/'))).toBe(false);
    });

    test('poc-broken fails at load, and stays off after three tries', async () => {
        const { host } = hostIn('broken');

        await host.install(await packOf('poc/broken'));

        for (let attempt = 0; attempt < 3; attempt++) {
            await expect(host.call('poc.broken', 'anything', [])).rejects.toThrow('The extension stopped');
        }

        expect((await host.list())[0]?.status).toBe('crashed');
    });
});
