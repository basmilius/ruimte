import { afterAll, expect, test } from 'bun:test';
import { serveDevExtensionFiles } from './dev-extension-files';

const server = serveDevExtensionFiles(
    'http://localhost:4212/',
    { answer: async (pathname, origin) => new Response(`${origin} ${pathname}`, { headers: { 'content-type': 'text/javascript' } }) },
    0
);

afterAll(() => server.close());

test('answers extension files for the dev origin, and nothing else', async () => {
    // On a fast machine the server listens before the test starts, and the event has passed.
    if (!server.listening) {
        await new Promise((resolve) => server.once('listening', resolve));
    }

    const { port } = server.address() as { port: number };
    const file = await fetch(`http://127.0.0.1:${port}/__extensions/a.b/dev-1/client/index.js`);

    expect(file.headers.get('content-type')).toBe('text/javascript');
    expect(await file.text()).toBe('http://localhost:4212 /__extensions/a.b/dev-1/client/index.js');
    expect((await fetch(`http://127.0.0.1:${port}/src/main.tsx`)).status).toBe(404);
});

test('answers a request whose file could not be read, rather than leaving it open', async () => {
    const failing = serveDevExtensionFiles(
        'http://localhost:4212/',
        {
            answer: async () => {
                throw new Error('On purpose');
            }
        },
        0
    );

    try {
        if (!failing.listening) {
            await new Promise((resolve) => failing.once('listening', resolve));
        }

        const { port } = failing.address() as { port: number };

        expect((await fetch(`http://127.0.0.1:${port}/__extensions/a.b/dev-1/client/index.js`)).status).toBe(500);
    } finally {
        failing.close();
    }
});
