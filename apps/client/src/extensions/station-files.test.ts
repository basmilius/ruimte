import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { REQUEST_SCHEMAS, type ExtensionInfo, type RequestMap, type RequestType } from '@ruimte/contracts';
import { machineExtensions } from '@/extensions/station-files';

const ORIGIN = 'https://station.test';

/* The page's one cache of extension files, as the service worker reads it by path. */
class FakeCache {
    readonly files = new Map<string, Response>();
    // A path whose put fails, as a full disk refuses one.
    refuse: string | null = null;

    async match(path: string): Promise<Response | undefined> {
        return this.files.get(new URL(path, ORIGIN).href);
    }

    async put(path: string, response: Response): Promise<void> {
        if (this.refuse !== null && path.endsWith(this.refuse)) {
            throw new Error('QuotaExceededError');
        }

        this.files.set(new URL(path, ORIGIN).href, response);
    }

    async keys(): Promise<{ url: string }[]> {
        return [...this.files.keys()].map((url) => ({ url }));
    }

    async delete(request: { url: string }): Promise<boolean> {
        return this.files.delete(request.url);
    }

    paths(): string[] {
        return [...this.files.keys()].map((url) => new URL(url).pathname).sort();
    }
}

/* The locks every window of one page shares, held until the promise of their holder settles; an exclusive one waits its turn. */
class FakeLocks {
    readonly held = new Map<string, number>();
    readonly #turns = new Map<string, Promise<unknown>>();
    // Told how many exclusive requests the page made so far.
    onExclusive: (made: number) => void = () => undefined;
    #exclusive = 0;

    async request<T>(name: string, options: { mode?: 'shared' | 'exclusive' }, hold: () => Promise<T>): Promise<T> {
        if (options.mode === 'shared') {
            return this.#hold(name, hold);
        }

        this.onExclusive(++this.#exclusive);

        const turn = (this.#turns.get(name) ?? Promise.resolve()).then(() => this.#hold(name, hold));

        this.#turns.set(
            name,
            turn.catch(() => undefined)
        );

        return turn;
    }

    async #hold<T>(name: string, hold: () => Promise<T>): Promise<T> {
        this.held.set(name, (this.held.get(name) ?? 0) + 1);

        try {
            return await hold();
        } finally {
            const left = (this.held.get(name) ?? 1) - 1;

            if (left === 0) {
                this.held.delete(name);
            } else {
                this.held.set(name, left);
            }
        }
    }

    async query(): Promise<{ held: { name: string }[] }> {
        return { held: [...this.held.keys()].map((name) => ({ name })) };
    }
}

let cache: FakeCache;
let before: { caches: unknown; serviceWorker: PropertyDescriptor | undefined; locks: PropertyDescriptor | undefined };

beforeEach(() => {
    cache = new FakeCache();
    before = {
        caches: (globalThis as { caches?: unknown }).caches,
        serviceWorker: Object.getOwnPropertyDescriptor(navigator, 'serviceWorker'),
        locks: Object.getOwnPropertyDescriptor(navigator, 'locks')
    };
    (globalThis as { caches?: unknown }).caches = { open: async () => cache };
    Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: { register: async () => undefined, ready: Promise.resolve({ active: null }), controller: {} }
    });
});

afterEach(() => {
    (globalThis as { caches?: unknown }).caches = before.caches;

    for (const [name, descriptor] of [
        ['serviceWorker', before.serviceWorker],
        ['locks', before.locks]
    ] as const) {
        if (descriptor === undefined) {
            delete (navigator as unknown as Record<string, unknown>)[name];
        } else {
            Object.defineProperty(navigator, name, descriptor);
        }
    }
});

interface Served {
    info: ExtensionInfo;
    files: Record<string, string>;
    // What `extension.clientFiles` answers instead, as a machine that updated it between its list and its files does.
    answers?: { hash: string; files: Record<string, string> }[];
    fails?: boolean;
}

/* A machine with these extensions, each handing over the files given for it. */
function machine(extensions: Served[]) {
    return {
        connection: { status: 'open' as const, attempts: 0, retryAt: null, features: Object.keys(REQUEST_SCHEMAS) },
        async request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
            if (type === 'extension.list') {
                return { extensions: extensions.map((entry) => entry.info) } as RequestMap[T]['result'];
            }

            const found = extensions.find((entry) => entry.info.manifest.id === (payload as { id: string }).id);

            if (found?.fails === true) {
                throw new Error('The build is not done');
            }

            return (found?.answers?.shift() ?? { hash: found?.info.hash ?? '', files: found?.files ?? {} }) as RequestMap[T]['result'];
        }
    };
}

function extension(id: string, hash: string, code: string, more: Partial<ExtensionInfo> = {}): Served {
    return {
        info: {
            manifest: { id, name: id, version: '0.1.0', api: 1, permissions: {} },
            hash,
            enabled: true,
            hasServer: false,
            hasClient: true,
            status: 'idle',
            ...more
        },
        files: { 'manifest.json': btoa('{}'), 'client/index.js': btoa(code) }
    };
}

describe('the extension files of Station', () => {
    test("keeps a window's files when another window loads what another machine has", async () => {
        await machineExtensions(machine([extension('acme.notes', 'aaa', 'one')]), 'machine-a');
        await machineExtensions(machine([extension('acme.board', 'bbb', 'two')]), 'machine-b');

        expect(cache.paths()).toEqual([
            '/__extensions/machine-a/acme.notes/aaa/.complete',
            '/__extensions/machine-a/acme.notes/aaa/client/index.js',
            '/__extensions/machine-a/acme.notes/aaa/manifest.json',
            '/__extensions/machine-b/acme.board/bbb/.complete',
            '/__extensions/machine-b/acme.board/bbb/client/index.js',
            '/__extensions/machine-b/acme.board/bbb/manifest.json'
        ]);
    });

    test('drops an older version of the same machine', async () => {
        await machineExtensions(machine([extension('acme.notes', 'aaa', 'one')]), 'machine-a');
        await machineExtensions(machine([extension('acme.notes', 'ccc', 'three')]), 'machine-a');

        expect(cache.paths()).toEqual([
            '/__extensions/machine-a/acme.notes/ccc/.complete',
            '/__extensions/machine-a/acme.notes/ccc/client/index.js',
            '/__extensions/machine-a/acme.notes/ccc/manifest.json'
        ]);
    });

    test('keeps an older version another window of the page still runs', async () => {
        const locks = new FakeLocks();

        Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
        await machineExtensions(machine([extension('acme.notes', 'aaa', 'one')]), 'machine-a');
        // The other window: it holds `aaa` as the first did, and this window moves on to `ccc`.
        void locks.request('ruimte-extension-files:/__extensions/machine-a/acme.notes/aaa/', { mode: 'shared' }, () => new Promise(() => undefined));
        await machineExtensions(machine([extension('acme.notes', 'ccc', 'three')]), 'machine-a');

        expect(cache.paths()).toContain('/__extensions/machine-a/acme.notes/aaa/client/index.js');
        expect(cache.paths()).toContain('/__extensions/machine-a/acme.notes/ccc/client/index.js');
    });

    test('gives a dev link of the same build number another address on another machine, and on its own machine once its files change', async () => {
        const dev = { devFolder: '/work/acme' };
        const {
            installed: [first]
        } = await machineExtensions(machine([extension('acme.dev', 'dev-1', 'one', dev)]), 'machine-a');
        const {
            installed: [other]
        } = await machineExtensions(machine([extension('acme.dev', 'dev-1', 'two', dev)]), 'machine-b');
        const {
            installed: [restarted]
        } = await machineExtensions(machine([extension('acme.dev', 'dev-1', 'three', dev)]), 'machine-a');
        const {
            installed: [again]
        } = await machineExtensions(machine([extension('acme.dev', 'dev-1', 'three', dev)]), 'machine-a');

        expect(new Set([first?.base, other?.base, restarted?.base]).size).toBe(3);
        expect(again?.base).toBe(restarted?.base as string);
        expect(again?.dev).toBe(true);
    });

    test('fetches a version again whose files did not all land, and leaves none of a fill that failed', async () => {
        cache.refuse = 'client/index.js';

        const failed = await machineExtensions(machine([extension('acme.notes', 'aaa', 'one')]), 'machine-a');

        cache.refuse = null;

        const filled = await machineExtensions(machine([extension('acme.notes', 'aaa', 'one')]), 'machine-a');

        expect(failed).toEqual({ installed: [], failures: { 'acme.notes': 'QuotaExceededError' } });
        expect(filled.installed.map((entry) => entry.base)).toEqual(['/__extensions/machine-a/acme.notes/aaa/']);
        expect(cache.paths()).toContain('/__extensions/machine-a/acme.notes/aaa/client/index.js');
    });

    test('reads the list again when an extension changed between the list and its files, so no files sit under the old hash', async () => {
        const served = extension('acme.notes', 'aaa', 'one');

        served.answers = [{ hash: 'bbb', files: { 'manifest.json': btoa('{}'), 'client/index.js': btoa('two') } }];

        const listed = machine([served]);
        const { installed } = await machineExtensions(
            {
                ...listed,
                request: async (type, payload) => {
                    const answer = await listed.request(type, payload);

                    // The list moves on once the files of the update were handed out.
                    if (type === 'extension.clientFiles') {
                        served.info = { ...served.info, hash: 'bbb' };
                        served.files = { 'manifest.json': btoa('{}'), 'client/index.js': btoa('two') };
                    }

                    return answer;
                }
            },
            'machine-a'
        );

        expect(installed.map((entry) => entry.base)).toEqual(['/__extensions/machine-a/acme.notes/bbb/']);
        expect(cache.paths().filter((path) => path.includes('/aaa/'))).toEqual([]);
    });

    test('loads the others when the files of one do not come, and says why for that one', async () => {
        const building = { ...extension('acme.dev', 'dev-2', 'one', { devFolder: '/work/acme' }), fails: true };
        const { installed, failures } = await machineExtensions(machine([building, extension('acme.notes', 'aaa', 'one')]), 'machine-a');

        expect(installed.map((entry) => entry.manifest.id)).toEqual(['acme.notes']);
        expect(failures).toEqual({ 'acme.dev': 'The build is not done' });
    });

    test('lists one the machine cannot read as off with why, asks none of its files, and runs no version of before', async () => {
        const { installed: previous } = await machineExtensions(machine([extension('acme.notes', 'aaa', 'one')]), 'machine-a');
        const damaged = {
            ...extension('acme.notes', 'damaged', '', { enabled: false, hasClient: false, status: 'disabled', error: 'manifest.json is no JSON' }),
            fails: true
        };
        const { installed, failures } = await machineExtensions(machine([damaged]), 'machine-a', { previous });

        expect(installed).toEqual([
            { manifest: damaged.info.manifest, base: '/__extensions/machine-a/acme.notes/damaged/', enabled: false, hasClient: false, dev: false }
        ]);
        expect(failures).toEqual({ 'acme.notes': 'manifest.json is no JSON' });
    });

    test('keeps the version of an extension whose files did not come only from the same machine, and turns it off when the new list does', async () => {
        const { installed: previous } = await machineExtensions(machine([extension('acme.notes', 'aaa', 'one')]), 'machine-a');
        const unreachable = { ...extension('acme.notes', 'bbb', 'two', { enabled: false }), fails: true };
        const elsewhere = await machineExtensions(machine([unreachable]), 'machine-b', { previous });
        const here = await machineExtensions(machine([unreachable]), 'machine-a', { previous });

        expect(elsewhere).toEqual({ installed: [], failures: { 'acme.notes': 'The build is not done' } });
        expect(here.installed).toEqual([{ ...(previous[0] as (typeof previous)[number]), enabled: false }]);
        expect(cache.paths()).toContain('/__extensions/machine-a/acme.notes/aaa/client/index.js');
    });

    test('lets a sync a newer one overtook touch neither the locks nor the files of the newer one', async () => {
        const locks = new FakeLocks();
        let answerOlder = (): void => undefined;
        const olderAnswered = new Promise<void>((resolve) => {
            answerOlder = resolve;
        });
        let newerBegan = false;
        const olderList = machine([extension('acme.overtaken', 'aaa', 'one')]);
        const slowMachine = {
            ...olderList,
            request: async <T extends RequestType>(type: T, payload: RequestMap[T]['payload']) => {
                if (type === 'extension.list') {
                    await olderAnswered;
                }

                return olderList.request(type, payload);
            }
        };
        const newerWaits = new Promise<void>((resolve) => {
            locks.onExclusive = (made) => {
                if (made === 2) {
                    resolve();
                }
            };
        });

        Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });

        const older = machineExtensions(slowMachine, 'machine-a', { current: () => !newerBegan });

        newerBegan = true;

        const newer = machineExtensions(machine([extension('acme.overtaken', 'ccc', 'three')]), 'machine-a');

        // The older list comes in last: after the newer sync is done, or once it waits for the older to finish its fill.
        await Promise.race([newer, newerWaits]);
        answerOlder();
        await Promise.all([older, newer]);

        expect(cache.paths()).toContain('/__extensions/machine-a/acme.overtaken/ccc/client/index.js');
        expect(cache.paths().filter((path) => path.includes('/aaa/'))).toEqual([]);
        expect([...locks.held.keys()]).toEqual(['ruimte-extension-files:/__extensions/machine-a/acme.overtaken/ccc/']);
    });

    test('serves a WebAssembly file as WebAssembly', async () => {
        const served = extension('acme.wasm', 'aaa', 'one');

        served.files['client/engine.wasm'] = btoa('\0asm');
        await machineExtensions(machine([served]), 'machine-a');

        expect((await cache.match('/__extensions/machine-a/acme.wasm/aaa/client/engine.wasm'))?.headers.get('content-type')).toBe('application/wasm');
    });
});
