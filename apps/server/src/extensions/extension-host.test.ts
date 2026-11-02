import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { ExtensionManifest } from '@ruimte/contracts';
import { ExtensionHost, type ExtensionHostOptions } from './extension-host.ts';
import type { ExtensionStore, StoredExtension } from './store.ts';

const root = mkdtempSync(join(tmpdir(), 'ruimte-extension-host-unit-'));
const hosts: ExtensionHost[] = [];

/* A `server/` that only says it is ready, and keeps what it was told. */
class FakeChild extends EventEmitter {
    readonly stdin = new PassThrough();
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
    readonly told: { type: string; id?: number; name?: string; payload?: unknown; code?: string; result?: unknown }[] = [];
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

function hostWith(manifest: Partial<ExtensionManifest>, options: Partial<Pick<ExtensionHostOptions, 'removeLanguageServers' | 'asks' | 'now'>> = {}): Hosted {
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

/* Starts the process with a first call and answers it, so what the test sends next meets one that runs. */
async function runningChild({ host, children }: Hosted, whileReady: (child: FakeChild) => void = () => undefined): Promise<FakeChild> {
    const call = host.call('acme.builds', 'add', []);

    await until(() => children.length > 0);

    const child = children[0] as FakeChild;

    child.say({ type: 'ready' });
    whileReady(child);
    await until(() => child.told.length === 1);
    child.say({ type: 'result', id: child.told[0]?.id, result: 1 });
    await call;

    return child;
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

    test('hands on only the events its permissions cover, as much of them as the API names', async () => {
        const hosted = hostWith({ permissions: { 'chats.read': 'Counts your chats' } });
        const child = await runningChild(hosted, (ready) => {
            ready.say({ type: 'subscribe', name: 'chat.status' });
            ready.say({ type: 'subscribe', name: 'session.status' });
            ready.say({ type: 'subscribe', name: 'session.output' });
        });
        const info = { chatId: 'chat-1', provider: 'claude', status: 'needs-you', model: 'opus', cwd: '/work', requests: [], agentSessionId: 'secret' };

        hosted.host.forwardEvent('chat.status', { chatId: 'chat-1', info });
        hosted.host.forwardEvent('session.status', { sessionId: 'term-1', agent: null });
        hosted.host.forwardEvent('session.output', { sessionId: 'term-1', data: 'ls' });
        await until(() => child.told.some((message) => message.type === 'event'));

        expect(child.told.filter((message) => message.type === 'event')).toEqual([
            { type: 'event', name: 'chat.status', payload: { chat: { id: 'chat-1', provider: 'claude', status: 'needsYou', model: 'opus', cwd: '/work' } } }
        ]);
        // The two refusals reach the log in either order, so wait for both.
        await until(() => hosted.log().includes('session.output') && hosted.log().includes('session.status'));
        expect(hosted.log()).toContain('session.status needs the permission terminals.read');
        expect(hosted.log()).toContain('session.output is no event an extension can follow');
    });

    test('an ask without its permission answers permission-denied, and the log says so', async () => {
        const hosted = hostWith({}, { asks: () => ({ 'chats.send': async () => undefined }) });
        const child = await runningChild(hosted);

        child.say({ type: 'ask', id: 7, method: 'chats.send', args: ['chat-1', 'Hello'] });
        await until(() => child.told.some((message) => message.type === 'answer'));

        expect(child.told.find((message) => message.type === 'answer')).toMatchObject({ id: 7, code: 'permission-denied' });
        await until(() => hosted.log().includes('permission-denied'));
    });

    test('a chat past its sends of the hour answers limit', async () => {
        const hosted = hostWith({ permissions: { 'chats.send': 'Pokes a chat' } }, { asks: () => ({ 'chats.send': async () => undefined }), now: () => 0 });
        const child = await runningChild(hosted);

        for (let id = 1; id <= 21; id++) {
            child.say({ type: 'ask', id, method: 'chats.send', args: ['chat-1', 'Hello'] });
        }

        await until(() => child.told.filter((message) => message.type === 'answer').length === 21);

        const answers = child.told.filter((message) => message.type === 'answer');

        expect(answers.filter((answer) => answer.code === undefined)).toHaveLength(20);
        expect(answers.find((answer) => answer.code !== undefined)).toMatchObject({ id: 21, code: 'limit' });
    });

    test('an action outside the list or the manifest is refused under its own code', async () => {
        const { host } = hostWith({ permissions: { 'launches.read': 'Lists launches' } }, {});

        await expect(host.runAction('acme.builds', 'project', 'launch.start', { launch: 'web' })).rejects.toMatchObject({ code: 'permission-denied' });
        await expect(host.runAction('acme.builds', 'project', 'session.write', {})).rejects.toMatchObject({ code: 'not-found' });
    });

    test('a method that throws fails, and one it lacks is not found', async () => {
        const hosted = hostWith({});
        const child = await runningChild(hosted);
        const calls = Promise.allSettled([hosted.host.call('acme.builds', 'fail', []), hosted.host.call('acme.builds', 'gone', [])]);

        await until(() => child.told.filter((message) => message.type === 'call').length === 3);

        const [, fail, gone] = child.told.filter((message) => message.type === 'call');

        child.say({ type: 'result', id: fail?.id, error: 'On purpose' });
        child.say({ type: 'result', id: gone?.id, error: 'No method gone', code: 'not-found' });

        expect(await calls).toMatchObject([
            { status: 'rejected', reason: { code: 'failed', message: 'On purpose' } },
            { status: 'rejected', reason: { code: 'not-found' } }
        ]);
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
