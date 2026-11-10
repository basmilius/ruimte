import { afterEach, describe, expect, test } from 'bun:test';
import { serverActions } from '../actions/server-actions-test-helpers.ts';
import type { CanvasHost } from '../canvas/host.ts';
import { catalog } from '../mcp/catalog-test-helpers.ts';
import { externalCallerOf, handleExternalMcpRequest } from '../mcp/external-route.ts';
import { ConsentBook } from './consent-book.ts';
import { CredentialStore } from './credential-store.ts';
import { FailureLimiter, refuseTunnelled } from './external-gate.ts';
import { externalHandler, ExternalListener } from './external-listener.ts';

const closers: Array<() => void> = [];

afterEach(() => {
    closers.splice(0).forEach((close) => close());
});

interface Running {
    port: number;
    credentials: CredentialStore;
}

function start(host: Partial<CanvasHost> = {}): Running {
    let counter = 0;
    const random = (bytes: number): string => `${'r'.repeat(bytes)}${(counter += 1)}`;
    const credentials = new CredentialStore({ now: Date.now, random });
    let listener!: ExternalListener;
    const handler = externalHandler({
        credentials,
        consent: new ConsentBook({ now: Date.now, random, pick: (limit) => counter++ % limit, changed: () => undefined }),
        limiter: new FailureLimiter(Date.now),
        serve: (request, credential, client) =>
            handleExternalMcpRequest(request, externalCallerOf(credential, client), { host: host as CanvasHost, actions: serverActions, tools: catalog() }),
        fetchMetadata: () => Promise.reject(new Error('no clients in this test')),
        now: Date.now,
        port: () => listener.port
    });

    listener = new ExternalListener(handler, 0);
    closers.push(() => listener.stop());

    return { port: listener.start(), credentials };
}

/* A proxy on loopback that forwards what it gets with the headers a tunnel adds, like `cloudflared` dialing from the machine. */
function proxyTo(port: number, forged: Record<string, string>): number {
    const proxy = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: (request) => {
            const url = new URL(request.url);
            const headers = new Headers(request.headers);

            for (const [name, value] of Object.entries(forged)) {
                headers.set(name, value);
            }

            return fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, { method: request.method, headers, body: request.body, redirect: 'manual' });
        }
    });

    closers.push(() => void proxy.stop(true));

    return proxy.port!;
}

const initialize = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

function post(port: number, token: string | null): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
            accept: 'application/json, text/event-stream',
            'content-type': 'application/json',
            ...(token === null ? {} : { authorization: `Bearer ${token}` })
        },
        body: JSON.stringify(initialize)
    });
}

describe('a request through a tunnel', () => {
    test('from loopback with forged headers and no token gets a 401', async () => {
        const { port } = start();
        const proxied = proxyTo(port, {
            'cf-ray': 'abc-AMS',
            'cf-connecting-ip': '127.0.0.1',
            host: '127.0.0.1',
            'x-forwarded-for': '127.0.0.1',
            'x-real-ip': '127.0.0.1'
        });

        expect((await post(proxied, null)).status).toBe(401);
        expect((await post(proxied, 'local-secret-guess')).status).toBe(401);
    });

    test('is judged by its credential on every request, and a bearer that stays off the hostname is refused through the proxy', async () => {
        const { port, credentials } = start();
        const { secret } = await credentials.createBearer({ label: 'Bot' });
        const proxied = proxyTo(port, { 'cf-ray': 'abc-AMS' });

        expect((await post(port, secret)).status).toBe(200);
        expect((await post(proxied, secret)).status).toBe(401);
    });

    test('finds no API route on the listener: every path but the route and the OAuth ones is a 404', async () => {
        const { port, credentials } = start();
        const { secret } = await credentials.createBearer({ label: 'Bot' });

        for (const path of [
            '/',
            '/ws',
            '/health',
            '/machine/status',
            '/machine/shutdown',
            '/fs/file?path=/etc/passwd',
            '/hooks/claude',
            '/context',
            '/auth/local-ticket',
            '/extensions/link'
        ]) {
            const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: '{}' });

            expect({ path, status: response.status }).toEqual({ path, status: 404 });
        }
    });

    test('is refused by the API port when it carries the headers of the edge', async () => {
        const api = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (request) => refuseTunnelled(request) ?? new Response('ok') });

        closers.push(() => void api.stop(true));

        const url = `http://127.0.0.1:${api.port}/health`;

        expect(await (await fetch(url)).text()).toBe('ok');
        expect((await fetch(url, { headers: { 'cf-ray': 'abc-AMS' } })).status).toBe(403);
        expect((await fetch(url, { headers: { 'cf-connecting-ip': '203.0.113.9' } })).status).toBe(403);
    });
});

describe('the listener', () => {
    test('listens on loopback only, and stops answering when it is closed', async () => {
        const listener = new ExternalListener(async () => new Response('ok'), 0);
        const port = listener.start();

        expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe('ok');
        expect(listener.start()).toBe(port);

        listener.stop();

        await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toBeDefined();
        expect(listener.port).toBeNull();
    });

    test('lets a call that lost its connection run to its end, so an agent it started keeps working', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let finished = false;
        let entered!: () => void;
        const reached = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const { port, credentials } = start({
            reach: {
                enabled: () => false,
                open: async () => {
                    entered();
                    await gate;
                    finished = true;

                    return [];
                },
                recent: async () => []
            } as unknown as CanvasHost['reach']
        });
        const { secret } = await credentials.createBearer({ label: 'Bot' });
        const controller = new AbortController();
        const pending = fetch(`http://127.0.0.1:${port}/mcp`, {
            method: 'POST',
            headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', authorization: `Bearer ${secret}` },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'project_list', arguments: {} } }),
            signal: controller.signal
        });

        await reached;
        controller.abort();
        await expect(pending).rejects.toBeDefined();
        release();

        // The work was never tied to the connection: nothing cancelled it, and nothing ended on the way.
        for (let waited = 0; !finished && waited < 200; waited++) {
            await Bun.sleep(5);
        }

        expect(finished).toBe(true);
    });
});
