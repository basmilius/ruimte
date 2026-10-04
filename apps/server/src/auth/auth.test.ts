import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crossOriginHeaders, decideAccess, handleLocalTicketRequest, isOwner, originAllowed, preflightHeaders, reachabilityOf, withHeaders } from './access.ts';
import { AuthStore } from './auth-store.ts';
import { generateKeyPair } from './keys.ts';

let home: string;
let clock: number;
let store: AuthStore;

// Nothing here hands out a ticket unless a test says so.
const NO_TICKETS = { ticketAccess: async () => null };

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-auth-'));
    clock = 1_000_000;
    store = new AuthStore(home, () => clock);
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe('AuthStore', () => {
    const statement = (publicKey: string, nonce = 'n'.repeat(22)) => ({
        publicKey,
        label: 'Laptop',
        nonce,
        keepNonceUntil: clock + 150_000,
        accountId: 'owner'
    });

    test('a statement lets a key in once per nonce, and the client survives a new store on the same home', async () => {
        const { publicKey } = generateKeyPair();
        const admitted = await store.admitStatement(statement(publicKey));
        expect(admitted).toEqual({ sessionId: expect.any(String), created: true });
        expect(await store.admitStatement(statement(publicKey))).toEqual({ refused: 'replayed' });
        const sessionId = 'sessionId' in admitted ? admitted.sessionId : '';

        const again = new AuthStore(home, () => clock);
        expect(await again.sessionForPublicKey(publicKey)).toBe(sessionId);
        expect(await again.list(sessionId)).toEqual([
            { id: sessionId, label: 'Laptop', origin: 'statement', createdAt: clock, lastSeenAt: clock, current: true }
        ]);
        // The key is public, so it is the one credential written down as it stands.
        expect(await readFile(join(home, 'auth.json'), 'utf8')).toContain(publicKey);
    });

    test('a client a pairing link or a session token let in before account-only no longer reads as one', async () => {
        const [linked, labeled, admitted] = [generateKeyPair(), generateKeyPair(), generateKeyPair()];
        const record = { label: 'old', createdAt: 1, lastSeenAt: 1 };
        await writeFile(
            join(home, 'auth.json'),
            JSON.stringify({
                sessions: [
                    { ...record, id: 'link-of-before-statements', publicKey: linked.publicKey },
                    { ...record, id: 'link', publicKey: labeled.publicKey, origin: 'link' },
                    { ...record, id: 'token', tokenHash: 'ab'.repeat(32) },
                    { ...record, id: 'statement', publicKey: admitted.publicKey, origin: 'statement', account: 'owner' }
                ]
            })
        );
        expect((await store.list(null)).map((session) => session.id)).toEqual(['statement']);
        expect(await store.sessionForPublicKey(linked.publicKey)).toBeNull();
        expect(await store.sessionForPublicKey(labeled.publicKey)).toBeNull();
        expect(await store.sessionForPublicKey(admitted.publicKey)).toBe('statement');
    });

    test('a client that proves its key is seen now, and one revoked since it was looked up is not', async () => {
        const { publicKey } = generateKeyPair();
        const admitted = await store.admitStatement(statement(publicKey));
        const sessionId = 'sessionId' in admitted ? admitted.sessionId : '';
        clock += 5_000;
        expect(await store.noteSeen(sessionId)).toBe(true);
        expect((await store.list(null))[0]?.lastSeenAt).toBe(clock);
        expect(await store.revoke(sessionId)).toBe(true);
        expect(await store.revoke(sessionId)).toBe(false);
        expect(await store.noteSeen(sessionId)).toBe(false);
        expect(await store.hasSession(sessionId)).toBe(false);
    });

    test('a revoked key gets nothing for its next statement, however good', async () => {
        const { publicKey } = generateKeyPair();
        const admitted = await store.admitStatement(statement(publicKey));
        await store.revoke('sessionId' in admitted ? admitted.sessionId : '');
        expect(await store.admitStatement(statement(publicKey, 'm'.repeat(22)))).toEqual({ refused: 'revoked' });
        expect(await store.sessionForPublicKey(publicKey)).toBeNull();
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

    test('origins: none, the desktop app, loopback and our own host pass, a stranger does not', () => {
        expect(originAllowed(null, 'box:4210')).toBe(true);
        expect(originAllowed('app://ruimte', '127.0.0.1:4210')).toBe(true);
        expect(originAllowed('app://elsewhere', '127.0.0.1:4210')).toBe(false);
        expect(originAllowed('http://localhost:5173', 'box:4210')).toBe(true);
        expect(originAllowed('http://box:4210', 'box:4210')).toBe(true);
        expect(originAllowed('https://evil.example', 'box:4210')).toBe(false);
        expect(originAllowed('https://app.example', null)).toBe(false);
        expect(originAllowed('not a url', 'box:4210')).toBe(false);
    });

    test('the local secret gets in, a loopback address alone does not', async () => {
        const options = { localSecret: 'the-local-secret', tickets: NO_TICKETS };
        const request = (token?: string, origin?: string) =>
            new Request(`http://box:4210/ws${token ? `?token=${token}` : ''}`, { headers: { host: 'box:4210', ...(origin ? { origin } : {}) } });

        // A tunnel or a reverse proxy makes every visitor loopback, so the address is no proof.
        expect(await decideAccess(request(), '127.0.0.1', options, 'socket')).toMatchObject({ ok: false, status: 401 });
        expect(await decideAccess(request('the-local-secret'), '127.0.0.1', options, 'socket')).toEqual({
            ok: true,
            access: { reachability: 'loopback', sessionId: null }
        });
        expect(await decideAccess(request('the-local-secre'), '127.0.0.1', options, 'socket')).toMatchObject({ ok: false, status: 401 });
        expect(await decideAccess(request(), '192.168.1.20', options, 'socket')).toMatchObject({ ok: false, status: 401 });
        expect(await decideAccess(request(undefined, 'https://evil.example'), '127.0.0.1', options, 'socket')).toMatchObject({ ok: false, status: 403 });
        expect(await decideAccess(request('bogus'), '192.168.1.20', options, 'socket')).toMatchObject({ ok: false, status: 401 });
    });

    test('a ticket gets in where the secret does', async () => {
        const options = {
            localSecret: 'the-local-secret',
            tickets: { ticketAccess: async (ticket: string) => (ticket === 'good-ticket' ? { sessionId: 'session-7' } : null) }
        };
        const request = (token: string) => new Request(`http://box:4210/ws?token=${token}`, { headers: { host: 'box:4210' } });

        expect(await decideAccess(request('good-ticket'), '192.168.1.20', options, 'socket')).toEqual({
            ok: true,
            access: { reachability: 'lan', sessionId: 'session-7' },
            ticket: 'good-ticket'
        });
        expect(await decideAccess(request('stale-ticket'), '192.168.1.20', options, 'socket')).toMatchObject({ ok: false, status: 401 });
    });

    test('the secret travels as a bearer as well, which is how `ruimte login` sends it', async () => {
        const options = { localSecret: 'the-local-secret', tickets: NO_TICKETS };
        const request = new Request('http://127.0.0.1:4210/machine/registration', { method: 'POST', headers: { authorization: 'Bearer the-local-secret' } });
        expect(await decideAccess(request, '127.0.0.1', options, 'local')).toMatchObject({ ok: true, access: { sessionId: null } });
    });

    test('what only the app on this machine may ask takes the local secret itself, never a ticket that stands in for it', async () => {
        const options = { localSecret: 'the-local-secret', tickets: { ticketAccess: async () => ({ sessionId: null }) } };
        const request = new Request('http://127.0.0.1:4210/machine/registration', { method: 'POST', headers: { authorization: 'Bearer local-ticket' } });
        expect(await decideAccess(request, '127.0.0.1', options, 'bytes')).toMatchObject({ ok: true, access: { sessionId: null } });
        expect(await decideAccess(request, '127.0.0.1', options, 'local')).toMatchObject({ ok: false, status: 403 });
    });

    test('the local secret trades for a ticket from the Authorization header only', async () => {
        const options = { localSecret: 'the-local-secret', tickets: NO_TICKETS };
        const tickets = { issueLocalTicket: () => ({ ticket: 'local-ticket', expiresIn: 1000 }) };
        const trade = (init: RequestInit, query = '') =>
            handleLocalTicketRequest(new Request(`http://127.0.0.1:4210/auth/local-ticket${query}`, init), options, tickets);

        const traded = trade({ method: 'POST', headers: { authorization: 'Bearer the-local-secret' } });
        expect(traded.status).toBe(200);
        expect(await traded.json()).toEqual({ ticket: 'local-ticket', expiresIn: 1000 });
        expect(trade({ method: 'POST' }, '?token=the-local-secret').status).toBe(401);
        expect(trade({ method: 'POST', headers: { authorization: 'Bearer something-else' } }).status).toBe(401);
        expect(trade({ method: 'GET', headers: { authorization: 'Bearer the-local-secret' } }).status).toBe(405);
        expect(trade({ method: 'POST', headers: { authorization: 'Bearer the-local-secret', origin: 'https://evil.example' } }).status).toBe(403);
    });

    test('a page on an origin the socket takes is told it may read the answer, and nobody else is', () => {
        const request = (origin?: string) =>
            new Request('http://127.0.0.1:4210/fs/file', { headers: { host: '127.0.0.1:4210', ...(origin ? { origin } : {}) } });
        expect(crossOriginHeaders(request('app://ruimte'))).toMatchObject({ 'access-control-allow-origin': 'app://ruimte', vary: 'origin' });
        expect(crossOriginHeaders(request('http://localhost:4212'))?.['access-control-allow-origin']).toBe('http://localhost:4212');
        expect(crossOriginHeaders(request('https://evil.example'))).toBeNull();
        expect(crossOriginHeaders(request())).toBeNull();
        const preflight = preflightHeaders(crossOriginHeaders(request('app://ruimte'))!);
        expect(preflight['access-control-allow-headers']).toContain('authorization');
        expect(preflight['access-control-allow-private-network']).toBe('true');
        expect(Object.values(preflight)).not.toContain('*');
    });

    test('headers go on a response in place, or on a copy when its headers are fixed', async () => {
        const plain = withHeaders(new Response('bytes'), { vary: 'origin' });
        expect(plain.headers.get('vary')).toBe('origin');
        const fixed = withHeaders(Response.redirect('http://127.0.0.1:4210/', 302), { vary: 'origin' });
        expect(fixed.status).toBe(302);
        expect(fixed.headers.get('vary')).toBe('origin');
        expect(fixed.headers.get('location')).toBe('http://127.0.0.1:4210/');
    });

    test('only a client on the local secret is the owner', () => {
        expect(isOwner({ reachability: 'loopback', sessionId: null })).toBe(true);
        expect(isOwner({ reachability: 'loopback', sessionId: 'in-over-a-tunnel' })).toBe(false);
        expect(isOwner({ reachability: 'lan', sessionId: 's1' })).toBe(false);
        expect(isOwner(undefined)).toBe(false);
    });
});
