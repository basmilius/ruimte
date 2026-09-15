import { describe, expect, test } from 'bun:test';
import { LoginStartQuerySchema } from '@ruimte/pulsar';
import { PENDING_LOGIN_LIFETIME_MS, beginWebLogin, completeWebLogin, webRedirectUriFor, type LoginStorage } from './web';

const memoryStorage = (): LoginStorage & { items: Map<string, string> } => {
    const items = new Map<string, string>();
    return {
        items,
        getItem: (key) => items.get(key) ?? null,
        setItem: (key, value) => {
            items.set(key, value);
        },
        removeItem: (key) => {
            items.delete(key);
        }
    };
};

const REDIRECT = 'https://station.ruimte.app/pulsar/callback';

const leave = async (storage: LoginStorage, now = 1_000, confirm?: boolean) => {
    const start = new URL(await beginWebLogin(storage, { addressBookUrl: 'https://pulsar.ruimte.app', redirectUri: REDIRECT, confirm, now }));
    return LoginStartQuerySchema.parse(Object.fromEntries(start.searchParams));
};

describe('signing in on the web', () => {
    test('only an origin the address book sends a login back to gets a redirect', () => {
        expect(webRedirectUriFor('https://station.ruimte.app')).toBe(REDIRECT);
        expect(webRedirectUriFor('http://localhost:5173')).toBe('http://localhost:5173/pulsar/callback');
        expect(webRedirectUriFor('https://evil.example.com')).toBeNull();
        expect(webRedirectUriFor('http://192.168.1.20:4210')).toBeNull();
    });

    test('the start URL carries this login state and challenge, and the return trades the code with the verifier kept beside it', async () => {
        const storage = memoryStorage();
        const query = await leave(storage);
        expect(query.redirect_uri).toBe(REDIRECT);
        const back = completeWebLogin(storage, new URLSearchParams({ code: 'c'.repeat(43), state: query.state }), 2_000);
        expect(back.code).toBe('c'.repeat(43));
        expect(back.redirectUri).toBe(REDIRECT);
        expect(back.verifier.length).toBeGreaterThanOrEqual(43);
        expect(back.confirm).toBe(false);
        expect(storage.items.size).toBe(0);
    });

    test('a login started from the account section comes back once saying so', async () => {
        const storage = memoryStorage();
        const query = await leave(storage, 1_000, true);
        const back = completeWebLogin(storage, new URLSearchParams({ code: 'c'.repeat(43), state: query.state }), 2_000);
        expect(back.confirm).toBe(true);
        expect(back.provider).toBe('github');
        expect(() => completeWebLogin(storage, new URLSearchParams({ code: 'c'.repeat(43), state: query.state }), 2_000)).toThrow('did not start');
    });

    test('a return for another login, a second return and a return nobody started are refused', async () => {
        const storage = memoryStorage();
        const query = await leave(storage);
        expect(() => completeWebLogin(storage, new URLSearchParams({ code: 'c'.repeat(43), state: 'someone-elses-state' }), 2_000)).toThrow('does not belong');
        expect(() => completeWebLogin(storage, new URLSearchParams({ code: 'c'.repeat(43), state: query.state }), 2_000)).toThrow('did not start');
    });

    test('a login left open too long is given up, and a cancelled one says so', async () => {
        const storage = memoryStorage();
        const query = await leave(storage, 0);
        expect(() => completeWebLogin(storage, new URLSearchParams({ code: 'c'.repeat(43), state: query.state }), PENDING_LOGIN_LIFETIME_MS + 1)).toThrow(
            'too long'
        );
        const cancelled = await leave(storage);
        expect(() => completeWebLogin(storage, new URLSearchParams({ error: 'access_denied', state: cancelled.state }), 2_000)).toThrow('cancelled');
    });

    test('a login that adds a provider says so on the way back, and a sign-in does not', async () => {
        const storage = memoryStorage();
        const start = new URL(
            await beginWebLogin(storage, {
                addressBookUrl: 'https://pulsar.ruimte.app',
                redirectUri: REDIRECT,
                provider: 'apple',
                link: 't'.repeat(43),
                now: 1_000
            })
        );
        expect(start.pathname).toBe('/auth/apple/start');
        const query = LoginStartQuerySchema.parse(Object.fromEntries(start.searchParams));
        expect(query.link).toBe('t'.repeat(43));
        expect(completeWebLogin(storage, new URLSearchParams({ code: 'c'.repeat(43), state: query.state }), 2_000).link).toBe(true);

        const plain = await leave(storage);
        expect(completeWebLogin(storage, new URLSearchParams({ code: 'c'.repeat(43), state: plain.state }), 2_000).link).toBe(false);
    });
});
