import { describe, expect, test } from 'bun:test';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { ACCESS_TOKEN_LIFETIME_MS, CredentialStore, RECENT_USE_MS } from './credential-store.ts';

const homeOf = tempHomes('ruimte-credentials-');

function store(home?: string, used?: () => void): { credentials: CredentialStore; clock: { now: number } } {
    const clock = { now: 1_000_000 };
    let counter = 0;
    const credentials = new CredentialStore({
        home,
        now: () => clock.now,
        random: (bytes) => `${'x'.repeat(bytes)}${(counter += 1)}`,
        used
    });

    return { credentials, clock };
}

describe('a bearer', () => {
    test('is made with the defaults of a hosted client: all projects, Work, supervised, no expiry', async () => {
        const { credentials } = store();
        const { credential, secret } = await credentials.createBearer({ label: 'Hosted bot' });

        expect(credential).toMatchObject({
            label: 'Hosted bot',
            kind: 'bearer',
            grant: { tier: 'work', projects: null, ceiling: 'supervised', approvals: false },
            expiresAt: null,
            bearerOnHostname: false
        });
        expect(secret.startsWith('rmb_')).toBe(true);
    });

    test('authenticates on loopback, and is a credential with a last use afterwards', async () => {
        const { credentials, clock } = store();
        const { secret } = await credentials.createBearer({ label: 'Bot' });

        clock.now += 5;

        const checked = credentials.authenticate(secret, 'loopback');

        expect(checked).toMatchObject({ ok: true, credential: { label: 'Bot', lastUsedAt: clock.now }, client: 'Bot' });
    });

    test('is refused on the public hostname unless the credential allows it', async () => {
        const { credentials } = store();
        const closed = await credentials.createBearer({ label: 'Closed' });
        const open = await credentials.createBearer({ label: 'Open', bearerOnHostname: true });

        expect(credentials.authenticate(closed.secret, 'hostname')).toEqual({ ok: false, reason: 'wrong-door' });
        expect(credentials.authenticate(open.secret, 'hostname')).toMatchObject({ ok: true });
    });

    test('refuses an unknown token, a session token and an empty one', async () => {
        const { credentials } = store();

        await credentials.createBearer({ label: 'Bot' });

        for (const token of ['nope', 'rmb_nope', 'a-session-token', '']) {
            expect(credentials.authenticate(token, 'loopback')).toEqual({ ok: false, reason: 'unknown' });
        }
    });

    test('is refused once it expired, and from the next request on once revoked', async () => {
        const { credentials, clock } = store();
        const { credential, secret } = await credentials.createBearer({ label: 'Bot', expiresAt: clock.now + 100 });

        expect(credentials.authenticate(secret, 'loopback')).toMatchObject({ ok: true });

        clock.now += 100;

        expect(credentials.authenticate(secret, 'loopback')).toEqual({ ok: false, reason: 'expired' });

        clock.now = 1_000_000;
        expect(credentials.authenticate(secret, 'loopback')).toMatchObject({ ok: true });
        expect(await credentials.revoke(credential.id)).toBe(true);
        expect(credentials.authenticate(secret, 'loopback')).toEqual({ ok: false, reason: 'unknown' });
        expect(await credentials.revoke(credential.id)).toBe(false);
    });

    test('keeps only a hash, in a file only its owner reads, and never the secret', async () => {
        const home = await homeOf();
        const { credentials } = store(home);
        const { secret } = await credentials.createBearer({ label: 'Bot' });
        const path = join(home, 'tunnels', 'credentials.json');
        const text = await readFile(path, 'utf8');

        expect(text).not.toContain(secret);
        expect(text).toContain('secretHash');
        // Windows has no POSIX modes; there the file lives in the user's own profile.
        if (process.platform !== 'win32') {
            expect((await stat(path)).mode & 0o777).toBe(0o600);
            expect((await stat(join(home, 'tunnels'))).mode & 0o777).toBe(0o700);
        }

        const again = store(home).credentials;

        await again.load();

        expect(again.authenticate(secret, 'loopback')).toMatchObject({ ok: true });

        await again.settled();
    });

    test('counts as a client in use for a while after its last request', async () => {
        const { credentials, clock } = store();
        const { secret } = await credentials.createBearer({ label: 'Bot' });

        expect(credentials.recentlyUsed()).toBe(0);
        credentials.authenticate(secret, 'loopback');
        expect(credentials.recentlyUsed()).toBe(1);

        clock.now += RECENT_USE_MS + 1;

        expect(credentials.recentlyUsed()).toBe(0);
    });

    test('says so on a first use and after a minute without one, not on every request', async () => {
        const uses: number[] = [];
        const { credentials, clock } = store(undefined, () => uses.push(clock.now));
        const { secret } = await credentials.createBearer({ label: 'Bot' });

        credentials.authenticate(secret, 'loopback');
        clock.now += 30_000;
        credentials.authenticate(secret, 'loopback');
        credentials.authenticate(secret, 'loopback');

        expect(uses).toEqual([1_000_000]);

        clock.now += 60_000;
        credentials.authenticate(secret, 'loopback');

        expect(uses).toEqual([1_000_000, 1_090_000]);
    });

    test('says nothing about a refused token', async () => {
        const uses: number[] = [];
        const { credentials, clock } = store(undefined, () => uses.push(clock.now));

        await credentials.createBearer({ label: 'Bot' });
        credentials.authenticate('rmb_nope', 'loopback');

        expect(uses).toEqual([]);
    });

    test('changes its grant only through an update from the app, and a narrower scope counts at once', async () => {
        const { credentials } = store();
        const { credential, secret } = await credentials.createBearer({ label: 'Bot' });

        await credentials.update(credential.id, { grant: { tier: 'read', projects: ['p1'] } });

        expect(credentials.authenticate(secret, 'loopback')).toMatchObject({
            ok: true,
            credential: { grant: { tier: 'read', projects: ['p1'], ceiling: 'supervised' } }
        });
    });
});

describe('an OAuth credential', () => {
    const grant = { tier: 'work', projects: null, ceiling: 'supervised', approvals: false } as const;

    test('is made with an access token that lasts an hour and a refresh token', async () => {
        const { credentials, clock } = store();
        const { tokens, credential } = await credentials.createOAuth({ label: 'Claude', clientId: 'https://client.example/meta.json', grant });

        expect(credential.kind).toBe('oauth');
        // The host consent verified, never the name the client's document gave.
        expect(credentials.authenticate(tokens.accessToken, 'hostname')).toMatchObject({ ok: true, client: 'client.example' });

        clock.now += ACCESS_TOKEN_LIFETIME_MS;

        expect(credentials.authenticate(tokens.accessToken, 'hostname')).toEqual({ ok: false, reason: 'expired' });
    });

    test('rotates the refresh token on every use, with no end date of its own', async () => {
        const { credentials, clock } = store();
        const clientId = 'https://client.example/meta.json';
        const first = await credentials.createOAuth({ label: 'Claude', clientId, grant });

        clock.now += 365 * 24 * 3600_000;

        const second = await credentials.refresh(first.tokens.refreshToken, clientId);

        expect(second).toMatchObject({ ok: true });

        if (!second.ok) {
            return;
        }

        expect(second.tokens.refreshToken).not.toBe(first.tokens.refreshToken);
        expect(credentials.authenticate(second.tokens.accessToken, 'hostname')).toMatchObject({ ok: true });
        expect(credentials.authenticate(first.tokens.accessToken, 'hostname')).toEqual({ ok: false, reason: 'unknown' });
    });

    test('revokes the credential when a refresh token that was rotated away is used again', async () => {
        const { credentials } = store();
        const clientId = 'https://client.example/meta.json';
        const first = await credentials.createOAuth({ label: 'Claude', clientId, grant });
        const second = await credentials.refresh(first.tokens.refreshToken, clientId);

        expect(second).toMatchObject({ ok: true });
        expect(await credentials.refresh(first.tokens.refreshToken, clientId)).toEqual({ ok: false, reason: 'reused' });
        expect(credentials.list()).toEqual([]);

        if (second.ok) {
            expect(credentials.authenticate(second.tokens.accessToken, 'hostname')).toEqual({ ok: false, reason: 'unknown' });
        }
    });

    test('refuses a refresh token for another client, and an access token as a refresh token', async () => {
        const { credentials } = store();
        const clientId = 'https://client.example/meta.json';
        const made = await credentials.createOAuth({ label: 'Claude', clientId, grant });

        expect(await credentials.refresh(made.tokens.refreshToken, 'https://other.example/meta.json')).toEqual({ ok: false, reason: 'unknown' });
        expect(await credentials.refresh(made.tokens.accessToken, clientId)).toEqual({ ok: false, reason: 'unknown' });
    });

    test('keeps no token in its file', async () => {
        const home = await homeOf();
        const { credentials } = store(home);
        const made = await credentials.createOAuth({ label: 'Claude', clientId: 'https://client.example/meta.json', grant });
        const text = await readFile(join(home, 'tunnels', 'credentials.json'), 'utf8');

        expect(text).not.toContain(made.tokens.accessToken);
        expect(text).not.toContain(made.tokens.refreshToken);
    });
});
