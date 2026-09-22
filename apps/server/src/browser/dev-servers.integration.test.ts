import { afterAll, describe, expect, it } from 'bun:test';
import { probeDevServers } from './dev-servers.ts';

const page = Bun.serve({
    port: 0,
    fetch: () =>
        new Response('<!doctype html><html><head><title>A dev server</title></head><body>hi</body></html>', { headers: { 'content-type': 'text/html' } })
});

const moved = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 302, headers: { location: '/login' } }) });

/* A server told to take any port answers with the one it got, and only its url is typed as having one. */
const portOf = (server: { url: URL }): number => Number(server.url.port);

afterAll(async () => {
    await page.stop(true);
    await moved.stop(true);
});

describe('probeDevServers against real servers', () => {
    it('finds a server on the loopback address and reads the name of its page', async () => {
        expect(await probeDevServers([portOf(page)])).toEqual([{ port: portOf(page), title: 'A dev server' }]);
    });

    it('counts a redirect as a server, since something is listening there', async () => {
        expect(await probeDevServers([portOf(moved)])).toEqual([{ port: portOf(moved) }]);
    });

    it('leaves out a port nothing is listening on', async () => {
        const free = Bun.serve({ port: 0, fetch: () => new Response('') });
        const port = portOf(free);
        await free.stop(true);
        expect(await probeDevServers([port])).toEqual([]);
    });
});
