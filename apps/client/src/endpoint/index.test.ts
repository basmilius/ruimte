import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useToasts } from '@/state/toasts';
import { pairEndpoint } from './index';

const local = (daemonId: string | null): Endpoint => ({
    id: LOCAL_ENDPOINT_ID,
    label: 'This machine',
    httpBaseUrl: 'http://127.0.0.1:4210',
    wsBaseUrl: 'ws://127.0.0.1:4210',
    reachability: 'loopback',
    token: null,
    daemonId,
    daemonPublicKey: null
});

const paired = (id: string, overrides: Partial<Endpoint> = {}): Endpoint => ({
    id,
    label: 'Studio',
    httpBaseUrl: 'http://old:4210',
    wsBaseUrl: 'ws://old:4210',
    reachability: 'lan',
    token: 'old-token',
    daemonId: id,
    daemonPublicKey: 'pinned-key',
    ...overrides
});

const endpointInfo = (id: string) => ({ id, label: 'Studio', platform: 'linux', version: '0.0.0', reachability: 'lan', authenticated: true });

const realFetch = globalThis.fetch;
const realWarn = console.warn;
/* Every request the pairing made, so a test can say what was asked as well as what came back. */
let asked: string[] = [];

/* A daemon that answers the two routes a pairing touches; `challengeId` null is one from before the challenge route. */
const daemonAnswering = (challengeId: string | null, pairId: string): void => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
        const url = String(input);
        asked.push(url);
        if (url.endsWith('/auth/challenge')) {
            return Promise.resolve(
                challengeId === null
                    ? new Response('No such route', { status: 404 })
                    : Response.json({ challenge: 'nonce', daemon: { id: challengeId, publicKey: 'daemon-key', signature: 'sig' } })
            );
        }
        return Promise.resolve(Response.json({ sessionToken: 'fresh-token', endpoint: endpointInfo(pairId) }));
    }) as typeof fetch;
};

describe('pairing with a daemon that is already in the list', () => {
    beforeEach(() => {
        asked = [];
        useEndpoints.setState({ endpoints: [local(null)], activeId: LOCAL_ENDPOINT_ID, mismatched: {} });
        useToasts.setState({ toasts: [] });
        // What a pairing tells the daemon to call this client is a browser fact, and the runner is not a browser.
        Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
        // No IndexedDB here, so the key loader falls back to a session token and says so on every call.
        console.warn = () => undefined;
    });

    afterEach(() => {
        globalThis.fetch = realFetch;
        console.warn = realWarn;
        Reflect.deleteProperty(globalThis, 'window');
    });

    test('a machine that is already listed keeps one row, on the address the pairing came from', async () => {
        useEndpoints.setState({ endpoints: [local(null), paired('daemon-a')] });
        daemonAnswering('daemon-a', 'daemon-a');

        const record = await pairEndpoint('http://new:4210/pair#one-time');

        const rows = useEndpoints.getState().endpoints;
        expect(rows.map((row) => row.id)).toEqual([LOCAL_ENDPOINT_ID, 'daemon-a']);
        expect(record.httpBaseUrl).toBe('http://new:4210');
        expect(rows[1]?.httpBaseUrl).toBe('http://new:4210');
        expect(rows[1]?.token).toBe('fresh-token');
        // A client that cannot sign pairs without a key of its own, and the daemon it pinned before is still that daemon.
        expect(rows[1]?.daemonPublicKey).toBe('pinned-key');
        expect(useToasts.getState().toasts[0]?.title).toBe('Studio is already in the list');
    });

    test('the daemon that served this page is refused before the one-time token is spent', async () => {
        useEndpoints.setState({ endpoints: [local('daemon-here')] });
        daemonAnswering('daemon-here', 'daemon-here');

        await expect(pairEndpoint('http://192.168.1.9:4210/pair#one-time')).rejects.toThrow('already in the list as This machine');

        expect(useEndpoints.getState().endpoints.map((row) => row.id)).toEqual([LOCAL_ENDPOINT_ID]);
        expect(asked).toEqual(['http://192.168.1.9:4210/auth/challenge']);
    });

    test('a daemon with no challenge route is caught by the id in its pairing answer', async () => {
        useEndpoints.setState({ endpoints: [local('daemon-here')] });
        daemonAnswering(null, 'daemon-here');

        await expect(pairEndpoint('http://192.168.1.9:4210/pair#one-time')).rejects.toThrow('already in the list as This machine');

        expect(useEndpoints.getState().endpoints.map((row) => row.id)).toEqual([LOCAL_ENDPOINT_ID]);
        expect(asked).toEqual(['http://192.168.1.9:4210/auth/challenge', 'http://192.168.1.9:4210/auth/pair']);
    });
});
