import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decideAccess, mayInvite, originAllowed, reachabilityOf } from './access.ts';
import { AuthStore, PAIRING_TTL_MS } from './auth-store.ts';
import { generateKeyPair, signMessage, verifySignature } from './keys.ts';

let home: string;
let clock: number;
let store: AuthStore;

// Nothing in these two blocks hands out a ticket, so a credential is only ever a session token here.
const NO_TICKETS = { ticketSession: () => null };

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
        expect(await store.pair('wrong', { label: 'laptop' })).toBeNull();
        const paired = await store.pair(token, { label: 'laptop' });
        expect(paired).not.toBeNull();
        expect(await store.pair(token, { label: 'again' })).toBeNull();

        expect(await store.authenticate(paired!.sessionToken!)).toBe(paired!.id);
        expect(await store.authenticate('nope')).toBeNull();
        // Only hashes reach the disk.
        const file = await readFile(join(home, 'auth.json'), 'utf8');
        expect(file).not.toContain(paired!.sessionToken);
        expect(file).toContain(paired!.id);

        const sessions = await store.list(paired!.id);
        expect(sessions).toEqual([{ id: paired!.id, label: 'laptop', origin: 'link', createdAt: clock, lastSeenAt: clock, current: true }]);
        expect(await store.revoke(paired!.id)).toBe(true);
        expect(await store.revoke(paired!.id)).toBe(false);
        expect(await store.authenticate(paired!.sessionToken!)).toBeNull();
    });

    test('a pairing token expires and a newer one replaces it', async () => {
        const first = store.issuePairingToken();
        const second = store.issuePairingToken();
        expect(await store.pair(first, { label: 'x' })).toBeNull();
        clock += PAIRING_TTL_MS + 1;
        expect(await store.pair(second, { label: 'x' })).toBeNull();
    });

    test('sessions survive a new store on the same home', async () => {
        const paired = await store.pair(store.issuePairingToken(), { label: 'phone' });
        const again = new AuthStore(home, () => clock);
        expect(await again.authenticate(paired!.sessionToken!)).toBe(paired!.id);
    });

    test('pairing with a public key hands out no token at all', async () => {
        const { publicKey } = generateKeyPair();
        const paired = await store.pair(store.issuePairingToken(), { label: 'laptop', publicKey });
        expect(paired?.sessionToken).toBeUndefined();
        expect(await store.sessionForPublicKey(publicKey)).toBe(paired!.id);
        expect(await store.sessionForPublicKey(generateKeyPair().publicKey)).toBeNull();
        // The key is public, so it is the one credential that may be written down as it stands.
        expect(await readFile(join(home, 'auth.json'), 'utf8')).toContain(publicKey);
    });

    test('something that is not a key pairs as a token holder instead of being written down', async () => {
        const paired = await store.pair(store.issuePairingToken(), { label: 'laptop', publicKey: 'not-a-key' });
        expect(paired?.sessionToken).toBeString();
        expect(await store.sessionForPublicKey('not-a-key')).toBeNull();
    });

    test('a client that paired on a token registers a key and loses the token the moment it signs', async () => {
        const paired = await store.pair(store.issuePairingToken(), { label: 'container' });
        const { publicKey } = generateKeyPair();

        expect(await store.registerKey('nobody', publicKey)).toBe(false);
        expect(await store.registerKey(paired!.id, 'not-a-key')).toBe(false);
        expect(await store.registerKey(paired!.id, publicKey)).toBe(true);
        // Asking again with the same key is the same answer; the client repeats it until its token goes.
        expect(await store.registerKey(paired!.id, publicKey)).toBe(true);
        // The token keeps working until the key has proved itself, so a client that cannot sign is never locked out.
        expect(await store.authenticate(paired!.sessionToken!)).toBe(paired!.id);

        await store.noteSignedIn(paired!.id);
        expect(await store.authenticate(paired!.sessionToken!)).toBeNull();
        expect(await store.sessionForPublicKey(publicKey)).toBe(paired!.id);
    });

    test('a key another client already registered is refused', async () => {
        const { publicKey } = generateKeyPair();
        const first = await store.pair(store.issuePairingToken(), { label: 'one', publicKey });
        const second = await store.pair(store.issuePairingToken(), { label: 'two' });
        expect(await store.registerKey(second!.id, publicKey)).toBe(false);
        expect(await store.sessionForPublicKey(publicKey)).toBe(first!.id);
    });

    test('a record from before public keys reads back as it was written', async () => {
        await writeFile(
            join(home, 'auth.json'),
            JSON.stringify({ sessions: [{ id: 'old', label: 'docker', tokenHash: 'a'.repeat(64), createdAt: 1, lastSeenAt: 2 }] })
        );
        const again = new AuthStore(home, () => clock);
        expect(await again.list(null)).toEqual([{ id: 'old', label: 'docker', origin: 'link', createdAt: 1, lastSeenAt: 2, current: false }]);
    });
});

describe('ed25519 keys', () => {
    test('a signature verifies against its own key and nothing else', () => {
        const pair = generateKeyPair();
        const other = generateKeyPair();
        const signature = signMessage(pair.privateKey, 'hello');
        expect(verifySignature(pair.publicKey, 'hello', signature)).toBe(true);
        expect(verifySignature(pair.publicKey, 'hello there', signature)).toBe(false);
        expect(verifySignature(other.publicKey, 'hello', signature)).toBe(false);
    });

    test('rubbish in the place of a key or a signature is false, never a throw', () => {
        const pair = generateKeyPair();
        expect(verifySignature('not-a-key', 'hello', signMessage(pair.privateKey, 'hello'))).toBe(false);
        expect(verifySignature(pair.publicKey, 'hello', 'not-a-signature')).toBe(false);
        expect(verifySignature('', '', '')).toBe(false);
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

    test('the local secret or a paired token gets in, a loopback address alone does not', async () => {
        const options = { allowedOrigins: [], localSecret: 'the-local-secret', tickets: NO_TICKETS };
        const request = (token?: string, origin?: string) =>
            new Request(`http://box:4210/ws${token ? `?token=${token}` : ''}`, { headers: { host: 'box:4210', ...(origin ? { origin } : {}) } });

        // A tunnel or a reverse proxy makes every visitor loopback, so the address is no proof.
        expect(await decideAccess(request(), '127.0.0.1', store, options)).toMatchObject({ ok: false, status: 401 });
        expect(await decideAccess(request('the-local-secret'), '127.0.0.1', store, options)).toEqual({
            ok: true,
            access: { reachability: 'loopback', sessionId: null }
        });
        expect(await decideAccess(request('the-local-secre'), '127.0.0.1', store, options)).toMatchObject({ ok: false, status: 401 });
        expect(await decideAccess(request(), '192.168.1.20', store, options)).toMatchObject({ ok: false, status: 401 });
        expect(await decideAccess(request(undefined, 'https://evil.example'), '127.0.0.1', store, options)).toMatchObject({ ok: false, status: 403 });

        const paired = await store.pair(store.issuePairingToken(), { label: 'laptop' });
        expect(await decideAccess(request(paired!.sessionToken!), '192.168.1.20', store, options)).toEqual({
            ok: true,
            access: { reachability: 'lan', sessionId: paired!.id }
        });
        expect(await decideAccess(request('bogus'), '192.168.1.20', store, options)).toMatchObject({ ok: false, status: 401 });
    });

    test('a ticket opens the same door as a token, in the same place', async () => {
        const options = {
            allowedOrigins: [],
            localSecret: 'the-local-secret',
            tickets: { ticketSession: (ticket: string) => (ticket === 'good-ticket' ? 'session-7' : null) }
        };
        const request = (token: string) => new Request(`http://box:4210/ws?token=${token}`, { headers: { host: 'box:4210' } });

        expect(await decideAccess(request('good-ticket'), '192.168.1.20', store, options)).toEqual({
            ok: true,
            access: { reachability: 'lan', sessionId: 'session-7' }
        });
        expect(await decideAccess(request('stale-ticket'), '192.168.1.20', store, options)).toMatchObject({ ok: false, status: 401 });
    });

    test('the secret travels as a bearer as well, which is how `ruimte pair` sends it', async () => {
        const options = { allowedOrigins: [], localSecret: 'the-local-secret', tickets: NO_TICKETS };
        const request = new Request('http://127.0.0.1:4210/auth/pairing-token', { method: 'POST', headers: { authorization: 'Bearer the-local-secret' } });
        expect(await decideAccess(request, '127.0.0.1', store, options)).toMatchObject({ ok: true, access: { sessionId: null } });
    });

    test('only the local secret may invite another machine', () => {
        expect(mayInvite({ reachability: 'loopback', sessionId: null })).toBe(true);
        expect(mayInvite({ reachability: 'loopback', sessionId: 'paired-over-a-tunnel' })).toBe(false);
        expect(mayInvite({ reachability: 'lan', sessionId: 's1' })).toBe(false);
        expect(mayInvite(undefined)).toBe(false);
    });
});
