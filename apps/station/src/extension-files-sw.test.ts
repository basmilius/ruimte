import { describe, expect, test } from 'bun:test';

const ORIGIN = 'https://station.ruimte.app';
const WORKER = await Bun.file(new URL('../public/extension-files-sw.js', import.meta.url)).text();

type FetchListener = (event: { request: Request; respondWith(answer: Promise<Response>): void }) => void;

/* The worker as a browser runs it, over a cache that holds `files` by path. */
function worker(files: Record<string, string>): (path: string) => Promise<Response> {
    const listeners = new Map<string, FetchListener>();
    const scope = {
        location: { origin: ORIGIN },
        addEventListener: (name: string, listener: FetchListener) => listeners.set(name, listener),
        skipWaiting: () => undefined,
        clients: { claim: async () => undefined }
    };
    const caches = {
        open: async () => ({ match: async (path: string) => (files[path] === undefined ? undefined : new Response(files[path])) })
    };

    new Function('self', 'caches', WORKER)(scope, caches);

    return (path) =>
        new Promise((resolve) => {
            listeners.get('fetch')?.({ request: new Request(`${ORIGIN}${path}`), respondWith: (answer) => void answer.then(resolve) });
        });
}

describe('the extension files worker', () => {
    test('answers a load of a version, its chunks too, with the files of that version', async () => {
        const fetchFile = worker({
            '/__extensions/box~1/acme.x/abc/client/index.js': 'entry',
            '/__extensions/box~1/acme.x/abc/client/chunks/shared.js': 'shared'
        });

        expect(await (await fetchFile('/__extensions/box~1/acme.x/abc~2/client/index.js')).text()).toBe('entry');
        expect(await (await fetchFile('/__extensions/box~1/acme.x/abc~2/client/chunks/shared.js')).text()).toBe('shared');
        expect(await (await fetchFile('/__extensions/box~1/acme.x/abc/client/index.js')).text()).toBe('entry');
        expect((await fetchFile('/__extensions/box/acme.x/abc~2/client/index.js')).status).toBe(404);
    });
});
