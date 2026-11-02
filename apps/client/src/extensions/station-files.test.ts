import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { REQUEST_SCHEMAS, type ExtensionInfo, type RequestMap, type RequestType } from '@ruimte/contracts';
import { machineExtensions } from '@/extensions/station-files';

const ORIGIN = 'https://station.test';

/* The page's one cache of extension files, as the service worker reads it by path. */
class FakeCache {
    readonly files = new Map<string, Response>();

    async match(path: string): Promise<Response | undefined> {
        return this.files.get(new URL(path, ORIGIN).href);
    }

    async put(path: string, response: Response): Promise<void> {
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

let cache: FakeCache;
let before: { caches: unknown; serviceWorker: PropertyDescriptor | undefined };

beforeEach(() => {
    cache = new FakeCache();
    before = { caches: (globalThis as { caches?: unknown }).caches, serviceWorker: Object.getOwnPropertyDescriptor(navigator, 'serviceWorker') };
    (globalThis as { caches?: unknown }).caches = { open: async () => cache };
    Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: { register: async () => undefined, ready: Promise.resolve({ active: null }), controller: {} }
    });
});

afterEach(() => {
    (globalThis as { caches?: unknown }).caches = before.caches;

    if (before.serviceWorker === undefined) {
        delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    } else {
        Object.defineProperty(navigator, 'serviceWorker', before.serviceWorker);
    }
});

/* A machine with these extensions, each handing over the files given for it. */
function machine(extensions: { info: ExtensionInfo; files: Record<string, string> }[]) {
    return {
        connection: { status: 'open' as const, attempts: 0, retryAt: null, features: Object.keys(REQUEST_SCHEMAS) },
        async request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
            if (type === 'extension.list') {
                return { extensions: extensions.map((entry) => entry.info) } as RequestMap[T]['result'];
            }

            const found = extensions.find((entry) => entry.info.manifest.id === (payload as { id: string }).id);

            return { hash: found?.info.hash ?? '', files: found?.files ?? {} } as RequestMap[T]['result'];
        }
    };
}

function extension(id: string, hash: string, code: string): { info: ExtensionInfo; files: Record<string, string> } {
    return {
        info: { manifest: { id, name: id, version: '0.1.0', api: 1, permissions: {} }, hash, enabled: true, hasServer: false, hasClient: true, status: 'idle' },
        files: { 'manifest.json': btoa('{}'), 'client/index.js': btoa(code) }
    };
}

describe('the extension files of Station', () => {
    test("keeps a window's files when another window loads what another machine has", async () => {
        await machineExtensions(machine([extension('acme.notes', 'aaa', 'one')]), 'machine-a');
        await machineExtensions(machine([extension('acme.board', 'bbb', 'two')]), 'machine-b');

        expect(cache.paths()).toEqual([
            '/__extensions/machine-a/acme.notes/aaa/client/index.js',
            '/__extensions/machine-a/acme.notes/aaa/manifest.json',
            '/__extensions/machine-b/acme.board/bbb/client/index.js',
            '/__extensions/machine-b/acme.board/bbb/manifest.json'
        ]);
    });

    test('drops an older version of the same machine', async () => {
        await machineExtensions(machine([extension('acme.notes', 'aaa', 'one')]), 'machine-a');
        await machineExtensions(machine([extension('acme.notes', 'ccc', 'three')]), 'machine-a');

        expect(cache.paths()).toEqual(['/__extensions/machine-a/acme.notes/ccc/client/index.js', '/__extensions/machine-a/acme.notes/ccc/manifest.json']);
    });

    test('gives a dev link of the same build number another address on another machine, and on its own machine once its files change', async () => {
        const [first] = await machineExtensions(machine([extension('acme.dev', 'dev-1', 'one')]), 'machine-a');
        const [other] = await machineExtensions(machine([extension('acme.dev', 'dev-1', 'two')]), 'machine-b');
        const [restarted] = await machineExtensions(machine([extension('acme.dev', 'dev-1', 'three')]), 'machine-a');
        const [again] = await machineExtensions(machine([extension('acme.dev', 'dev-1', 'three')]), 'machine-a');

        expect(new Set([first?.base, other?.base, restarted?.base]).size).toBe(3);
        expect(again?.base).toBe(restarted?.base as string);
    });
});
