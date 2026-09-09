import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decideAccess, originAllowed, reachabilityOf } from './access.ts';
import { AuthStore, PAIRING_TTL_MS } from './auth-store.ts';

let home: string;
let clock: number;
let store: AuthStore;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-auth-'));
    clock = 1_000_000;
    store = new AuthStore(home, () => clock);
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe('AuthStore', () => {
    test('a pairing token works once and turns into a session token that authenticates', async () => {
        const token = store.issuePairingToken();
        expect(await store.pair('wrong', 'laptop')).toBeNull();
        const paired = await store.pair(token, 'laptop');
        expect(paired).not.toBeNull();
        expect(await store.pair(token, 'again')).toBeNull();

        expect(await store.authenticate(paired!.sessionToken)).toBe(paired!.id);
        expect(await store.authenticate('nope')).toBeNull();
        // Only hashes reach the disk.
        const file = await readFile(join(home, 'auth.json'), 'utf8');
        expect(file).not.toContain(paired!.sessionToken);
        expect(file).toContain(paired!.id);

        const sessions = await store.list(paired!.id);
        expect(sessions).toEqual([{ id: paired!.id, label: 'laptop', createdAt: clock, lastSeenAt: clock, current: true }]);
        expect(await store.revoke(paired!.id)).toBe(true);
        expect(await store.revoke(paired!.id)).toBe(false);
        expect(await store.authenticate(paired!.sessionToken)).toBeNull();
    });

    test('a pairing token expires and a newer one replaces it', async () => {
        const first = store.issuePairingToken();
        const second = store.issuePairingToken();
        expect(await store.pair(first, 'x')).toBeNull();
        clock += PAIRING_TTL_MS + 1;
        expect(await store.pair(second, 'x')).toBeNull();
    });

    test('sessions survive a new store on the same home', async () => {
        const paired = await store.pair(store.issuePairingToken(), 'phone');
        const again = new AuthStore(home, () => clock);
        expect(await again.authenticate(paired!.sessionToken)).toBe(paired!.id);
    });
});

describe('access', () => {
    test('reachability from the address', () => {
        expect(reachabilityOf('127.0.0.1')).toBe('loopback');
        expect(reachabilityOf('::1')).toBe('loopback');
        expect(reachabilityOf('192.168.1.20')).toBe('lan');
        expect(reachabilityOf('::ffff:10.0.0.5')).toBe('lan');
        expect(reachabilityOf('203.0.113.9')).toBe('public');
    });

    test('origins: none, loopback and our own host pass, a stranger does not unless configured', () => {
        expect(originAllowed(null, 'box:4210', [])).toBe(true);
        expect(originAllowed('http://localhost:5173', 'box:4210', [])).toBe(true);
        expect(originAllowed('http://box:4210', 'box:4210', [])).toBe(true);
        expect(originAllowed('https://evil.example', 'box:4210', [])).toBe(false);
        expect(originAllowed('https://app.example', 'box:4210', ['https://app.example'])).toBe(true);
        expect(originAllowed('not a url', 'box:4210', [])).toBe(false);
    });

    test('loopback passes without a token, anything else needs a paired one', async () => {
        const options = { allowedOrigins: [], requireToken: false };
        const request = (token?: string, origin?: string) =>
            new Request(`http://box:4210/ws${token ? `?token=${token}` : ''}`, { headers: { host: 'box:4210', ...(origin ? { origin } : {}) } });

        expect(await decideAccess(request(), '127.0.0.1', store, options)).toEqual({ ok: true, access: { reachability: 'loopback', sessionId: null } });
        expect(await decideAccess(request(), '192.168.1.20', store, options)).toMatchObject({ ok: false, status: 401 });
        expect(await decideAccess(request(undefined, 'https://evil.example'), '127.0.0.1', store, options)).toMatchObject({ ok: false, status: 403 });

        const paired = await store.pair(store.issuePairingToken(), 'laptop');
        expect(await decideAccess(request(paired!.sessionToken), '192.168.1.20', store, options)).toEqual({
            ok: true,
            access: { reachability: 'lan', sessionId: paired!.id }
        });
        expect(await decideAccess(request('bogus'), '192.168.1.20', store, options)).toMatchObject({ ok: false, status: 401 });
        expect(await decideAccess(request(), '127.0.0.1', store, { ...options, requireToken: true })).toMatchObject({ ok: false, status: 401 });
    });
});
