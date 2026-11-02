import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { ExtensionManifest } from '@ruimte/contracts';
import { ExtensionHost } from './extension-host.ts';
import type { ExtensionStore, StoredExtension } from './store.ts';

const root = mkdtempSync(join(tmpdir(), 'ruimte-extension-host-unit-'));
const hosts: ExtensionHost[] = [];

/* A `server/` that only says it is ready, and keeps what it was told. */
class FakeChild extends EventEmitter {
    readonly stdin = new PassThrough();
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
    readonly told: { type: string; id?: number; name?: string }[] = [];
    killed = false;

    constructor() {
        super();
        this.stdin.setEncoding('utf8');
        this.stdin.on('data', (chunk: string) => {
            for (const line of chunk.split('\n').filter((each) => each !== '')) {
                this.told.push(JSON.parse(line) as { type: string });
            }
        });
    }

    say(message: object): void {
        this.stdout.write(`${JSON.stringify(message)}\n`);
    }

    kill(): void {
        this.killed = true;
        this.emit('exit', null);
    }
}

interface Hosted {
    host: ExtensionHost;
    children: FakeChild[];
    // How many starts read the server entry, which is where setting a process up begins.
    setups: () => number;
    log: () => string;
}

function hostWith(manifest: Partial<ExtensionManifest>, options: { removeLanguageServers?: (id: string) => Promise<void> } = {}): Hosted {
    const folder = mkdtempSync(join(root, 'extension-'));
    const children: FakeChild[] = [];
    const extension: StoredExtension = {
        manifest: { id: 'acme.builds', name: 'Builds', version: '0.1.0', api: 1, ...manifest },
        hash: 'hash',
        enabled: true,
        folder
    };
    let setups = 0;
    const store = {
        list: async () => [extension],
        get: async (id: string) => (id === extension.manifest.id ? extension : null),
        setEnabled: async (_id: string, enabled: boolean) => {
            extension.enabled = enabled;
        },
        serverEntry: () => {
            setups += 1;

            return join(folder, 'server', 'index.js');
        },
        dataFolder: () => join(folder, 'data'),
        logFile: () => join(folder, 'log.txt')
    };
    const host = new ExtensionHost({
        store: store as unknown as ExtensionStore,
        ...options,
        spawnProcess: (() => {
            const child = new FakeChild();

            children.push(child);

            return child;
        }) as never
    });

    hosts.push(host);

    // The host appends without waiting, so the file may not be there yet.
    return { host, children, setups: () => setups, log: () => (existsSync(store.logFile()) ? readFileSync(store.logFile(), 'utf8') : '') };
}

async function until(condition: () => boolean): Promise<void> {
    while (!condition()) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

afterEach(() => hosts.splice(0).forEach((host) => host.stopAll()));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('ExtensionHost', () => {
    test('two calls at once start one process, and a stop reaches it', async () => {
        const { host, children } = hostWith({});
        const calls = Promise.allSettled([host.call('acme.builds', 'add', []), host.call('acme.builds', 'add', [])]);

        await until(() => children.length > 0);
        children[0]?.say({ type: 'ready' });
        await until(() => children[0]?.told.length === 2);
        host.stopAll();

        expect((await calls).map((call) => call.status)).toEqual(['rejected', 'rejected']);
        expect(children).toHaveLength(1);
        expect(children[0]?.killed).toBe(true);
    });

    test('a stop while the process is still being set up leaves none running', async () => {
        const { host, children, setups } = hostWith({});
        const call = host.call('acme.builds', 'add', []);

        await until(() => setups() > 0);
        await host.setEnabled('acme.builds', false);

        await expect(call).rejects.toThrow('The extension stopped');
        expect(children.every((child) => child.killed)).toBe(true);
    });

    test('hands on only the events its permissions cover', async () => {
        const { host, children, log } = hostWith({ permissions: { 'chats.read': 'Counts your chats' } });
        const call = host.call('acme.builds', 'add', []);

        await until(() => children.length > 0);

        const child = children[0] as FakeChild;

        child.say({ type: 'ready' });
        child.say({ type: 'subscribe', name: 'chat.status' });
        child.say({ type: 'subscribe', name: 'session.output' });
        child.say({ type: 'subscribe', name: 'project.changed' });
        await until(() => child.told.length === 1);
        child.say({ type: 'result', id: child.told[0]?.id, result: 1 });
        await call;
        host.forwardEvent('chat.status', {});
        host.forwardEvent('session.output', {});
        host.forwardEvent('project.changed', {});
        await until(() => child.told.length > 1);

        expect(child.told.filter((message) => message.type === 'event').map((message) => message.name)).toEqual(['chat.status']);
        await until(() => log().includes('project.changed'));
        expect(log()).toContain('session.output needs the permission terminals.read');
    });

    test('turning it off takes its language servers away, and turning it on starts it to add them again', async () => {
        const removed: string[] = [];
        const { host, children } = hostWith(
            { permissions: { 'languages.servers': 'Adds one' } },
            { removeLanguageServers: async (id) => void removed.push(id) }
        );

        await host.setEnabled('acme.builds', false);

        expect(removed).toEqual(['acme.builds']);
        expect(children).toHaveLength(0);

        const enabling = host.setEnabled('acme.builds', true);

        await until(() => children.length > 0);
        children[0]?.say({ type: 'ready' });
        await enabling;

        expect(await host.list().then((list) => list[0]?.status)).toBe('running');
    });

    test('keys written at once all stay', async () => {
        const { host } = hostWith({});

        await Promise.all(['one', 'two', 'three'].map((key) => host.storageSet('acme.builds', key, key)));

        expect(await Promise.all(['one', 'two', 'three'].map((key) => host.storageGet('acme.builds', key)))).toEqual(['one', 'two', 'three']);
    });
});
