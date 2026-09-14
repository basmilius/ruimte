import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { clientAuthMessage, daemonChallengeMessage } from '@ruimte/contracts';
import { socketUrlFor, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useToasts } from '@/state/toasts';
import { createClientKeyLoader, type ClientKey, type KeyStore } from './client-key';
import { forgetTicket, rememberTicket } from './credentials';
import { signIn, socketAddressFor } from './handshake';

const DAEMON_ID = 'daemon-xyz';

const memoryStore = (): KeyStore => {
    let held: CryptoKeyPair | null = null;
    return { read: async () => held, write: async (pair) => void (held = pair) };
};

const base64url = (bytes: ArrayBuffer): string =>
    btoa(String.fromCharCode(...new Uint8Array(bytes)))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '');

/* A stand-in for the daemon: one key pair, and the two answers the handshake asks it for. */
const makeDaemon = async (id = DAEMON_ID) => {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const publicKey = base64url(await crypto.subtle.exportKey('raw', pair.publicKey));
    return {
        id,
        publicKey,
        async challenge(nonce: string) {
            const signature = base64url(
                await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(daemonChallengeMessage(id, nonce)))
            );
            return { challenge: nonce, daemon: { id, publicKey, signature } };
        }
    };
};

const row = (overrides: Partial<Endpoint> = {}): Endpoint => ({
    id: DAEMON_ID,
    label: 'the box',
    httpBaseUrl: 'http://box:4210',
    wsBaseUrl: 'ws://box:4210',
    reachability: 'lan',
    token: null,
    daemonId: DAEMON_ID,
    daemonPublicKey: null,
    ...overrides
});

let key: ClientKey;
let asked: string[];
const realFetch = globalThis.fetch;

/* Answers the two auth routes and records what was asked, so a test can say which the client reached. */
const serve = (routes: Record<string, () => Promise<Response> | Response>): void => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        asked.push(url);
        const route = Object.entries(routes).find(([path]) => url.endsWith(path));
        return route ? route[1]() : new Response('Not found', { status: 404 });
    }) as typeof fetch;
};

beforeEach(async () => {
    key ??= (await createClientKeyLoader(memoryStore())())!;
    asked = [];
    forgetTicket(DAEMON_ID);
    useEndpoints.setState({ endpoints: [row()], activeId: DAEMON_ID, mismatched: {} });
    useToasts.setState({ toasts: [] });
});

afterEach(() => {
    globalThis.fetch = realFetch;
});

describe('signing in with a key pair', () => {
    test('the ticket it signs for is what the socket URL carries from then on', async () => {
        const daemon = await makeDaemon();
        serve({
            '/auth/challenge': async () => Response.json(await daemon.challenge('nonce-1')),
            '/auth/ticket': () => Response.json({ ticket: 'ticket-1', expiresIn: 1000 })
        });
        const endpoint = row({ daemonPublicKey: daemon.publicKey, token: 'an old session token' });
        useEndpoints.setState({ endpoints: [endpoint] });

        expect(await signIn(endpoint, key)).toBe('ticket-1');
        expect(socketUrlFor(useEndpoints.getState().endpoints[0]!)).toBe('ws://box:4210/ws?token=ticket-1');
        // The token that used to sit in every URL is gone the moment a ticket works.
        expect(useEndpoints.getState().endpoints[0]!.token).toBeNull();
    });

    test('what it signs is bound to the machine it pinned, not to the one that answered', async () => {
        const daemon = await makeDaemon();
        let signed: { publicKey: string; challenge: string; signature: string } | null = null;
        serve({
            '/auth/challenge': async () => Response.json(await daemon.challenge('nonce-2')),
            '/auth/ticket': () => Response.json({ ticket: 'ticket-2', expiresIn: 1000 })
        });
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/auth/ticket')) {
                signed = JSON.parse(String(init?.body));
                return Response.json({ ticket: 'ticket-2', expiresIn: 1000 });
            }
            return Response.json(await daemon.challenge('nonce-2'));
        }) as typeof fetch;

        await signIn(row({ daemonPublicKey: daemon.publicKey }), key);
        const sent = signed!;
        expect(sent.publicKey).toBe(key.publicKey);
        const verified = await crypto.subtle.verify(
            { name: 'Ed25519' },
            await crypto.subtle.importKey(
                'raw',
                Uint8Array.from(atob(key.publicKey.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0)),
                { name: 'Ed25519' },
                false,
                ['verify']
            ),
            Uint8Array.from(atob(sent.signature.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0)),
            new TextEncoder().encode(clientAuthMessage(DAEMON_ID, 'nonce-2', key.publicKey))
        );
        expect(verified).toBe(true);
    });

    test('a daemon that answers with another key is refused before anything is signed', async () => {
        const imposter = await makeDaemon();
        serve({
            '/auth/challenge': async () => Response.json(await imposter.challenge('nonce-3')),
            '/auth/ticket': () => Response.json({ ticket: 'never', expiresIn: 1000 })
        });
        const pinned = (await makeDaemon()).publicKey;

        await expect(signIn(row({ daemonPublicKey: pinned }), key)).rejects.toThrow(/does not hold the key/);
        expect(asked.some((url) => url.endsWith('/auth/ticket'))).toBe(false);
        expect(useToasts.getState().toasts[0]?.title).toContain('cannot prove its identity');
    });

    test('a signature that does not check out is the same refusal', async () => {
        const daemon = await makeDaemon();
        serve({
            '/auth/challenge': async () => {
                const answer = await daemon.challenge('nonce-4');
                return Response.json({ ...answer, daemon: { ...answer.daemon, signature: base64url(new ArrayBuffer(64)) } });
            }
        });
        await expect(signIn(row({ daemonPublicKey: daemon.publicKey }), key)).rejects.toThrow(/does not hold the key/);
    });

    test('a daemon from before the handshake answers nothing and the client falls back', async () => {
        const daemon = await makeDaemon();
        serve({});
        const endpoint = row({ daemonPublicKey: daemon.publicKey, token: 'an old session token' });
        useEndpoints.setState({ endpoints: [endpoint] });

        expect(await signIn(endpoint, key)).toBeNull();
        // Nothing is dropped on the way out: the token is the only thing that still opens that socket.
        expect(useEndpoints.getState().endpoints[0]!.token).toBe('an old session token');
    });

    test('a client the daemon does not know any more is told to pair again', async () => {
        const daemon = await makeDaemon();
        serve({
            '/auth/challenge': async () => Response.json(await daemon.challenge('nonce-5')),
            '/auth/ticket': () => new Response('gone', { status: 401 })
        });
        rememberTicket(DAEMON_ID, 'a ticket from a connection before this');
        expect(await signIn(row({ daemonPublicKey: daemon.publicKey }), key)).toBeNull();
        expect(useToasts.getState().toasts[0]?.title).toContain('does not know this client');
        // The ticket it was carrying is worth nothing either; sending it again would only be refused.
        expect(socketUrlFor(row({ token: 'nothing-else-left' }))).toBe('ws://box:4210/ws?token=nothing-else-left');
    });
});

describe('the address a socket opens on', () => {
    test('an endpoint with nothing pinned signs nothing and sends what it has', async () => {
        serve({});
        useEndpoints.setState({ endpoints: [row({ token: 'plain-token' })] });
        expect(await socketAddressFor(DAEMON_ID)).toBe('ws://box:4210/ws?token=plain-token');
        expect(asked).toEqual([]);
    });

    test('a machine this client forgot has no address at all', async () => {
        useEndpoints.setState({ endpoints: [] });
        await expect(socketAddressFor(DAEMON_ID)).rejects.toThrow(/No endpoint/);
    });
});
