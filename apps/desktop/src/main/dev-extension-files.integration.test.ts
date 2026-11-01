import { afterAll, expect, test } from 'bun:test';
import { serveDevExtensionFiles } from './dev-extension-files';

const server = serveDevExtensionFiles(
    'http://localhost:4212/',
    { answer: async (pathname, origin) => new Response(`${origin} ${pathname}`, { headers: { 'content-type': 'text/javascript' } }) },
    0
);

afterAll(() => server.close());

test('answers extension files for the dev origin, and nothing else', async () => {
    await new Promise((resolve) => server.once('listening', resolve));

    const { port } = server.address() as { port: number };
    const file = await fetch(`http://127.0.0.1:${port}/__extensions/a.b/dev-1/client/index.js`);

    expect(file.headers.get('content-type')).toBe('text/javascript');
    expect(await file.text()).toBe('http://localhost:4212 /__extensions/a.b/dev-1/client/index.js');
    expect((await fetch(`http://127.0.0.1:${port}/src/main.tsx`)).status).toBe(404);
});
