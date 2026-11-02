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

    say(message: unknown): void {
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
    // Holds every store read from now on, each answering what the store held when it was asked, until the returned release.
    holdReads: () => () => void;
}

function hostWith(
    manifest: Partial<ExtensionManifest>,
    options: Partial<Pick<ExtensionHostOptions, 'removeLanguageServers' | 'asks' | 'now' | 'files' | 'runAction' | 'startChat'>> = {}
): Hosted {
    const folder = mkdtempSync(join(root, 'extension-'));
    const children: FakeChild[] = [];
    const extension: StoredExtension = {
        manifest: { id: 'acme.builds', name: 'Builds', version: '0.1.0', api: 1, ...manifest },
        hash: 'hash',
        enabled: true,
        folder
    };
    let setups = 0;
    let held: Promise<void> | null = null;
    const store = {
        list: async () => [extension],
        get: async (id: string) => {
            const answer = id === extension.manifest.id ? { ...extension } : null;

            await held;

            return answer;
        },
        setEnabled: async (_id: string, enabled: boolean) => {
            extension.enabled = enabled;
        },
        remove: async () => {
            rmSync(folder, { recursive: true, force: true });
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
    return {
        host,
        children,
        setups: () => setups,
        log: () => (existsSync(store.logFile()) ? readFileSync(store.logFile(), 'utf8') : ''),
        holdReads: () => {
            const { promise, resolve } = Promise.withResolvers<void>();

            held = promise;

            return () => {
                held = null;
                resolve();
            };
        }
    };
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

    test('one that is turned off neither runs an action nor starts a chat', async () => {
        const ran: string[] = [];
        const { host } = hostWith(
            { permissions: { 'launches.run': 'Starts launches', 'agents.start': 'Starts chats' } },
            {
                runAction: async (_id, _project, action) => void ran.push(action),
                startChat: async () => {
                    ran.push('chat');

                    return { nodeId: 'node-1' };
                }
            }
        );

        await host.setEnabled('acme.builds', false);

        await expect(host.runAction('acme.builds', 'project', 'launch.start', { launch: 'web' })).rejects.toMatchObject({ code: 'unavailable' });
        await expect(host.startAgent('acme.builds', { projectId: 'project' })).rejects.toMatchObject({ code: 'unavailable' });
        expect(ran).toEqual([]);
    });

    test('an ask that came in before a turn off is not answered after it', async () => {
        const sent: unknown[] = [];
        const hosted = hostWith(
            { permissions: { 'chats.send': 'Pokes a chat' } },
            { asks: () => ({ 'chats.send': async (...args: never[]) => void sent.push(args) }) }
        );
        const child = await runningChild(hosted);
        const release = hosted.holdReads();

        child.say({ type: 'ask', id: 9, method: 'chats.send', args: ['chat-1', 'Hello'] });
        await new Promise((resolve) => setImmediate(resolve));
        await hosted.host.setEnabled('acme.builds', false);
        release();
        await until(() => sent.length > 0 || hosted.log().includes('chats.send answered'));

        expect(sent).toEqual([]);
        expect(hosted.log()).toContain('chats.send answered unavailable');
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

    test('every client hears a key once it is written, from a client or from server/', async () => {
        const hosted = hostWith({});
        const heard: unknown[] = [];

        hosted.host.subscribe('client-a', (event) => void heard.push(event));
        hosted.host.subscribe('client-b', (event) => void heard.push(event));

        const child = await runningChild(hosted);

        heard.length = 0;
        await hosted.host.storageSet('acme.builds', 'draft', { text: 'one' });
        child.say({ type: 'ask', id: 5, method: 'storage.delete', args: ['draft'] });
        await until(() => child.told.some((message) => message.type === 'answer'));

        expect(heard.filter((event) => (event as { event: string }).event === 'extension.storageChanged')).toEqual([
            { event: 'extension.storageChanged', payload: { id: 'acme.builds', key: 'draft', value: { text: 'one' } } },
            { event: 'extension.storageChanged', payload: { id: 'acme.builds', key: 'draft', value: { text: 'one' } } },
            { event: 'extension.storageChanged', payload: { id: 'acme.builds', key: 'draft' } },
            { event: 'extension.storageChanged', payload: { id: 'acme.builds', key: 'draft' } }
        ]);
    });

    test('a removal waits for the storage write under way, and refuses a new one, so nothing makes the folder again', async () => {
        const { promise: writing, resolve: letWrite } = Promise.withResolvers<void>();
        const written: string[] = [];
        const hosted = hostWith(
            {},
            {
                files: {
                    mkdir: async () => undefined,
                    readText: async () => {
                        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
                    },
                    write: async (file) => {
                        await writing;
                        written.push(file);
                    },
                    rename: async () => undefined,
                    append: async () => undefined
                }
            }
        );
        const { host } = hosted;
        const before = host.storageSet('acme.builds', 'key', 1);
        let removed = false;
        const removing = host.remove('acme.builds').then(() => (removed = true));

        await new Promise((resolve) => setImmediate(resolve));

        await expect(host.storageSet('acme.builds', 'key', 2)).rejects.toMatchObject({ code: 'unavailable' });
        expect(removed).toBe(false);

        letWrite();
        await before;
        await removing;

        expect(written).toHaveLength(1);
    });

    test('a storage file it cannot read is refused, never written over', async () => {
        const writes: string[] = [];
        let failure: Error = Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
        const { host } = hostWith(
            {},
            {
                files: {
                    mkdir: async () => undefined,
                    readText: async () => {
                        throw failure;
                    },
                    write: async (_file, text) => void writes.push(text),
                    rename: async () => undefined,
                    append: async () => undefined
                }
            }
        );

        await expect(host.storageSet('acme.builds', 'key', 1)).rejects.toMatchObject({ code: 'failed' });
        await expect(host.storageDelete('acme.builds', 'key')).rejects.toMatchObject({ code: 'failed' });
        await expect(host.storageGet('acme.builds', 'key')).rejects.toMatchObject({ code: 'failed' });

        failure = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });

        await host.storageSet('acme.builds', 'key', 1);

        expect(writes).toEqual(['{"key":1}']);
    });

    test('a storage file that is no JSON object is refused, never written over', async () => {
        const { host } = hostWith({});
        const file = join(root, 'damaged-storage.json');

        await Bun.write(file, '{ "kept": tr');

        const damaged = hostWith(
            {},
            {
                files: {
                    mkdir: async () => undefined,
                    readText: async () => readFileSync(file, 'utf8'),
                    write: async () => {
                        throw new Error('Wrote over a damaged file');
                    },
                    rename: async () => undefined,
                    append: async () => undefined
                }
            }
        );

        await expect(damaged.host.storageSet('acme.builds', 'key', 1)).rejects.toMatchObject({ code: 'failed' });
        expect(await host.storageGet('acme.builds', 'constructor')).toBeUndefined();
        expect(await host.storageGet('acme.builds', '__proto__')).toBeUndefined();

        await host.storageSet('acme.builds', '__proto__', 'own');

        expect(await host.storageGet('acme.builds', '__proto__')).toBe('own');
    });

    test('a line on stdout that is no message neither stops the machine nor the extension', async () => {
        const hosted = hostWith({});
        const child = await runningChild(hosted);

        child.stdout.write('null\n42\n"text"\n[]\n{"type":"result"}\n{"type":"ask","id":"x"}\n{"type":"emit"}\nplain words\n');

        const call = hosted.host.call('acme.builds', 'add', []);

        await until(() => child.told.filter((message) => message.type === 'call').length === 2);
        child.say({ type: 'result', id: child.told.at(-1)?.id, result: 2 });

        expect(await call).toBe(2);
        await until(() => hosted.log().includes('plain words'));
    });
});
