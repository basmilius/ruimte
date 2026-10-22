import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DesktopBridge } from '@/desktop/bridge';
import { httpUrlFor } from '@/transport/machine-url';
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';
import { forgetTicket, rememberLocalSecret, rememberTicket } from './credentials';
import { socketAddressFor } from './handshake';

const DAEMON_ID = 'daemon-xyz';

function row(overrides: Partial<Endpoint> = {}): Endpoint {
    return {
        id: DAEMON_ID,
        label: 'the box',
        httpBaseUrl: 'http://box:4210',
        wsBaseUrl: 'ws://box:4210',
        reachability: 'lan',
        daemonId: DAEMON_ID,
        daemonPublicKey: null,
        ...overrides
    };
}

let asked: string[];
const realFetch = globalThis.fetch;

/* Answers the routes it is given and records what was asked, so a test can say which the client reached. */
function serve(routes: Record<string, () => Promise<Response> | Response>): void {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        asked.push(url);
        const route = Object.entries(routes).find(([path]) => url.endsWith(path));
        return route ? route[1]() : new Response('Not found', { status: 404 });
    }) as typeof fetch;
}

beforeEach(() => {
    asked = [];
    forgetTicket(DAEMON_ID);
    useEndpoints.setState({ endpoints: [row()], activeId: DAEMON_ID, mismatched: {} });
});

afterEach(() => {
    globalThis.fetch = realFetch;
});

describe('the address a socket opens on', () => {
    test('a row of another machine asks nothing over HTTP and sends the ticket it has', async () => {
        serve({});
        useEndpoints.setState({ endpoints: [row({ daemonPublicKey: 'A'.repeat(43) })] });
        rememberTicket(DAEMON_ID, 'ticket-1');
        expect(await socketAddressFor(DAEMON_ID)).toBe('ws://box:4210/ws?token=ticket-1');
        expect(asked).toEqual([]);
    });

    test('a machine this client forgot has no address at all', async () => {
        useEndpoints.setState({ endpoints: [] });
        await expect(socketAddressFor(DAEMON_ID)).rejects.toThrow(/is not in the list/);
    });
});

describe('the address of the local row', () => {
    const SECRET = 'the-local-secret';
    const scope = globalThis as unknown as { window?: { ruimteDesktop?: Partial<DesktopBridge> } };
    const local = row({ id: LOCAL_ENDPOINT_ID, httpBaseUrl: 'http://127.0.0.1:4211', wsBaseUrl: 'ws://127.0.0.1:4211', daemonId: null });
    let headers: Array<string | null>;

    beforeEach(() => {
        scope.window = { ruimteDesktop: { localSecret: async () => SECRET } };
        headers = [];
        forgetTicket(LOCAL_ENDPOINT_ID);
        useEndpoints.setState({ endpoints: [local], activeId: LOCAL_ENDPOINT_ID });
    });

    afterEach(() => {
        delete scope.window;
        rememberLocalSecret(LOCAL_ENDPOINT_ID, null);
    });

    const answer = (response: () => Response): void => {
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            asked.push(String(input));
            headers.push(new Headers(init?.headers).get('authorization'));
            return response();
        }) as typeof fetch;
    };

    test('trades the secret for a ticket over a header, and no URL of the row carries the secret', async () => {
        let issued = 0;
        answer(() => Response.json({ ticket: `local-ticket-${++issued}`, expiresIn: 1000 }));

        expect(await socketAddressFor(LOCAL_ENDPOINT_ID)).toBe('ws://127.0.0.1:4211/ws?token=local-ticket-1');
        expect(asked).toEqual(['http://127.0.0.1:4211/auth/local-ticket']);
        expect(headers).toEqual([`Bearer ${SECRET}`]);
        const image = httpUrlFor(LOCAL_ENDPOINT_ID, { kind: 'attachment', chatId: 'c1', attachmentId: 'a1' });
        expect(image).toBe('http://127.0.0.1:4211/attachments/c1/a1?token=local-ticket-1');
        expect(httpUrlFor(LOCAL_ENDPOINT_ID, { kind: 'file', path: '/tmp/x.png', mtime: 1, size: 2 })).not.toContain(SECRET);

        // A ticket opens one socket, so every reconnect trades again.
        expect(await socketAddressFor(LOCAL_ENDPOINT_ID)).toBe('ws://127.0.0.1:4211/ws?token=local-ticket-2');
    });

    test('a failed trade never puts the secret in the URL, and leaves the last ticket', async () => {
        answer(() => Response.json({ ticket: 'local-ticket-1', expiresIn: 1000 }));
        expect(await socketAddressFor(LOCAL_ENDPOINT_ID)).toBe('ws://127.0.0.1:4211/ws?token=local-ticket-1');

        for (const failure of [
            () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }),
            () => new Response('Not found', { status: 404 }),
            () => new Response('That is not the secret of this machine', { status: 401 })
        ]) {
            answer(failure);
            expect(await socketAddressFor(LOCAL_ENDPOINT_ID)).toBe('ws://127.0.0.1:4211/ws?token=local-ticket-1');
        }

        forgetTicket(LOCAL_ENDPOINT_ID);
        expect(await socketAddressFor(LOCAL_ENDPOINT_ID)).toBe('ws://127.0.0.1:4211/ws');
    });
});
