import { describe, expect, test } from 'bun:test';
import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { AddressBookClient, AddressBookRequestError } from './address-book-client.ts';
import type { SessionResult } from './address-book.ts';
import { SessionVault, type SessionSigner, type SessionStore, type StoredSession } from './session-vault.ts';
import { sessionKeyMessage, sessionRefreshMessage } from './signing.ts';

const token = (seed: string): string => seed.repeat(43).slice(0, 43);
const account = { id: 'account-1', provider: 'github' as const, login: 'someone' };
const NOW = 1_800_000_000_000;

const memoryStore = (): SessionStore & { held: StoredSession | null; writes: number } => {
    const store = {
        held: null as StoredSession | null,
        writes: 0,
        read: async () => store.held,
        write: async (session: StoredSession | null) => {
            store.held = session;
            store.writes += 1;
        }
    };
    return store;
};

const newSigner = (): SessionSigner => {
    const pair = generateKeyPairSync('ed25519');
    return {
        publicKey: pair.publicKey.export({ format: 'jwk' }).x ?? '',
        sign: async (message) => sign(null, Buffer.from(message), pair.privateKey).toString('base64url')
    };
};

const verifies = (publicKey: string, message: string, signature: unknown): boolean =>
    typeof signature === 'string' &&
    verify(
        null,
        Buffer.from(message),
        createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' }),
        Buffer.from(signature, 'base64url')
    );

interface Recorded {
    method: string;
    path: string;
    authorization: string | null;
    body: unknown;
}

/* The address book's session routes, rotating one refresh token at a time the way the Worker does. */
const fakeAddressBook = () => {
    const calls: Recorded[] = [];
    let generation = 0;
    let liveRefresh: string | null = null;
    let reachable = true;
    let boundKey: string | null = null;
    const session = (): SessionResult => {
        generation += 1;
        liveRefresh = token(String.fromCharCode(96 + generation));
        return { accessToken: token(String(generation)), accessExpiresAt: NOW + 900_000, refreshToken: liveRefresh, expiresAt: NOW + 86_400_000, account };
    };
    const fetch = async (input: string, init: RequestInit): Promise<Response> => {
        const url = new URL(input);
        const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
        calls.push({ method: init.method ?? 'GET', path: url.pathname, authorization: new Headers(init.headers).get('authorization'), body });
        if (!reachable) {
            throw new TypeError('fetch failed');
        }
        if (url.pathname === '/v1/session' && init.method === 'POST') {
            if (!verifies(String(body?.sessionKey), sessionKeyMessage(String(body?.code), String(body?.sessionKey)), body?.sessionKeySignature)) {
                return Response.json({ error: { code: 'bad-signature', message: 'The session key did not sign this login' } }, { status: 403 });
            }
            boundKey = String(body?.sessionKey);
            return Response.json(session());
        }
        if (url.pathname === '/v1/session/refresh') {
            const signed = boundKey !== null && verifies(boundKey, sessionRefreshMessage(String(body?.refreshToken), Number(body?.issuedAt)), body?.signature);
            if (body?.refreshToken !== liveRefresh || !signed) {
                return Response.json({ error: { code: 'unauthorized', message: 'Sign in again' } }, { status: 401 });
            }
            return Response.json(session());
        }
        if (url.pathname === '/v1/session' && init.method === 'DELETE') {
            return new Response(null, { status: 204 });
        }
        return Response.json({ error: { code: 'not-found', message: 'No such route' } }, { status: 404 });
    };
    return {
        calls,
        client: new AddressBookClient({ baseUrl: 'https://pulsar.test/', fetch }),
        revokeEverything: () => {
            liveRefresh = null;
        },
        setReachable: (value: boolean) => {
            reachable = value;
        }
    };
};

const exchange = { code: token('c'), codeVerifier: 'v'.repeat(43), redirectUri: 'http://127.0.0.1:5000/pulsar/callback', label: 'Laptop' };

// One key for the whole test unless it says otherwise, the way a device keeps one.
const deviceSigner = newSigner();
const keyed = async (): Promise<SessionSigner | null> => deviceSigner;

describe('SessionVault', () => {
    test('a login code becomes a session whose refresh token is kept and never handed out', async () => {
        const book = fakeAddressBook();
        const store = memoryStore();
        const vault = new SessionVault({ client: book.client, store, signer: keyed, now: () => NOW });
        const view = await vault.exchange(exchange);
        expect(view).toEqual({ accessToken: token('1'), accessExpiresAt: NOW + 900_000, expiresAt: NOW + 86_400_000, account });
        expect(Object.keys(view)).not.toContain('refreshToken');
        expect(store.held).toEqual({ refreshToken: token('a'), expiresAt: NOW + 86_400_000, account });
        expect(book.calls[0]).toMatchObject({ method: 'POST', path: '/v1/session', body: { ...exchange, sessionKey: deviceSigner.publicKey } });
    });

    test('a refresh rotates the kept token, and two refreshes at once spend it only once', async () => {
        const book = fakeAddressBook();
        const store = memoryStore();
        const vault = new SessionVault({ client: book.client, store, signer: keyed, now: () => NOW });
        await vault.exchange(exchange);
        const [first, second] = await Promise.all([vault.refresh(), vault.refresh()]);
        expect(first).toBe(second);
        expect(first?.accessToken).toBe(token('2'));
        expect(store.held?.refreshToken).toBe(token('b'));
        expect(book.calls.filter((call) => call.path === '/v1/session/refresh')).toHaveLength(1);

        // A later start reads the kept token and carries on with it.
        const restarted = new SessionVault({ client: book.client, store, signer: keyed, now: () => NOW });
        expect(await restarted.restore()).toEqual({ account, expiresAt: NOW + 86_400_000 });
        expect((await restarted.refresh())?.accessToken).toBe(token('3'));
    });

    test('a refresh token the address book no longer takes signs out, and a network failure keeps the session', async () => {
        const book = fakeAddressBook();
        const store = memoryStore();
        const vault = new SessionVault({ client: book.client, store, signer: keyed, now: () => NOW });
        await vault.exchange(exchange);

        book.setReachable(false);
        const failure = await vault.refresh().catch((e: unknown) => e);
        expect(failure).toBeInstanceOf(AddressBookRequestError);
        expect((failure as AddressBookRequestError).code).toBe('network');
        expect(store.held).not.toBeNull();

        book.setReachable(true);
        book.revokeEverything();
        expect(await vault.refresh()).toBeNull();
        expect(store.held).toBeNull();
        expect(await vault.restore()).toBeNull();
    });

    test('a session past its end is forgotten without asking anybody', async () => {
        const book = fakeAddressBook();
        const store = memoryStore();
        let now = NOW;
        const vault = new SessionVault({ client: book.client, store, signer: keyed, now: () => now });
        await vault.exchange(exchange);
        now = NOW + 86_400_000;
        expect(await vault.restore()).toBeNull();
        expect(await vault.refresh()).toBeNull();
        expect(book.calls.filter((call) => call.path === '/v1/session/refresh')).toHaveLength(0);
    });

    test('signing out ends the session at the address book with the access token and forgets it here', async () => {
        const book = fakeAddressBook();
        const store = memoryStore();
        const vault = new SessionVault({ client: book.client, store, signer: keyed, now: () => NOW });
        await vault.exchange(exchange);
        await vault.signOut();
        expect(store.held).toBeNull();
        expect(book.calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/v1/session', authorization: `Bearer ${token('1')}` });

        // Forgotten here even when the address book cannot be told.
        await vault.exchange(exchange);
        book.setReachable(false);
        await vault.signOut();
        expect(store.held).toBeNull();
    });
});

/* `navigator.locks` for one name: whoever asks waits for everyone before. */
const fakeLock = () => {
    let tail: Promise<unknown> = Promise.resolve();
    let holding = 0;
    let mostAtOnce = 0;
    const exclusive = <T>(run: () => Promise<T>): Promise<T> => {
        const turn = tail.then(async () => {
            holding += 1;
            mostAtOnce = Math.max(mostAtOnce, holding);
            try {
                return await run();
            } finally {
                holding -= 1;
            }
        });
        tail = turn.catch(() => undefined);
        return turn;
    };
    return {
        exclusive,
        get mostAtOnce(): number {
            return mostAtOnce;
        }
    };
};

describe('SessionVaults over one store', () => {
    test('two tabs refreshing at once take turns, so each token is spent once and the session survives', async () => {
        const book = fakeAddressBook();
        const store = memoryStore();
        const lock = fakeLock();
        const first = new SessionVault({ client: book.client, store, signer: keyed, exclusive: lock.exclusive, now: () => NOW });
        const second = new SessionVault({ client: book.client, store, signer: keyed, exclusive: lock.exclusive, now: () => NOW });
        await first.exchange(exchange);

        const [fromFirst, fromSecond] = await Promise.all([first.refresh(), second.refresh()]);
        expect(lock.mostAtOnce).toBe(1);
        expect([fromFirst?.accessToken, fromSecond?.accessToken]).toEqual([token('2'), token('3')]);
        // The second read the token the first rotated to, instead of the one both saw before waiting.
        const spent = book.calls.filter((call) => call.path === '/v1/session/refresh').map((call) => (call.body as { refreshToken: string }).refreshToken);
        expect(spent).toEqual([token('a'), token('b')]);
        expect(store.held?.refreshToken).toBe(token('c'));
    });
});

describe('SessionVault and its key', () => {
    test('a device that lost its key is signed out rather than left with a session it cannot refresh', async () => {
        const book = fakeAddressBook();
        const store = memoryStore();
        let signer: SessionSigner | null = deviceSigner;
        const vault = new SessionVault({ client: book.client, store, signer: async () => signer, now: () => NOW });
        await vault.exchange(exchange);
        signer = null;
        expect(await vault.refresh()).toBeNull();
        expect(store.held).toBeNull();
        expect(book.calls.filter((call) => call.path === '/v1/session/refresh')).toHaveLength(0);
    });

    test('a key that is not the one the session was opened with is signed out', async () => {
        const book = fakeAddressBook();
        const store = memoryStore();
        let signer: SessionSigner = deviceSigner;
        const vault = new SessionVault({ client: book.client, store, signer: async () => signer, now: () => NOW });
        await vault.exchange(exchange);
        signer = newSigner();
        expect(await vault.refresh()).toBeNull();
        expect(store.held).toBeNull();
    });

    test('no session is opened without a key', async () => {
        const book = fakeAddressBook();
        const vault = new SessionVault({ client: book.client, store: memoryStore(), signer: async () => null, now: () => NOW });
        await expect(vault.exchange(exchange)).rejects.toThrow('no key');
        expect(book.calls).toHaveLength(0);
    });
});

describe('AddressBookClient', () => {
    test('an error answer becomes an error with the code the address book gave, and an answer of the wrong shape is refused', async () => {
        const client = new AddressBookClient({
            baseUrl: 'https://pulsar.test',
            fetch: async (input) =>
                input.endsWith('/v1/machines')
                    ? Response.json({ machines: [{ id: 'm', name: '' }] })
                    : Response.json({ error: { code: 'rate-limited', message: 'Wait a minute' } }, { status: 429 })
        });
        const limited = (await client
            .requestStatement(token('t'), { machineId: 'm', clientPublicKey: token('k'), nonce: 'n'.repeat(22), signature: 's'.repeat(86) })
            .catch((e: unknown) => e)) as AddressBookRequestError;
        expect([limited.code, limited.status, limited.message]).toEqual(['rate-limited', 429, 'Wait a minute']);
        const unreadable = (await client.listMachines(token('t')).catch((e: unknown) => e)) as AddressBookRequestError;
        expect(unreadable.code).toBe('bad-answer');
    });

    test('a machine id is escaped into the path and the bearer rides in a header', async () => {
        const seen: { url: string; authorization: string | null }[] = [];
        const client = new AddressBookClient({
            baseUrl: 'https://pulsar.test',
            fetch: async (input, init) => {
                seen.push({ url: input, authorization: new Headers(init.headers).get('authorization') });
                return new Response(null, { status: 204 });
            }
        });
        await client.deleteMachine(token('t'), 'a/b c');
        expect(seen).toEqual([{ url: 'https://pulsar.test/v1/machines/a%2Fb%20c', authorization: `Bearer ${token('t')}` }]);
    });
});
