import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { sessionRefreshMessage, type SessionRefreshPayload, type SessionResult } from '@ruimte/pulsar';
import type { Env } from './env.ts';
import { refreshSession } from './login.ts';
import { ACCESS_LIFETIME_MS, ROTATION_GRACE_MS, authenticate, createSession, rotateSession } from './sessions.ts';
import { d1, migratedDatabase } from './test/sqlite-d1.ts';

const NOW = 1_900_000_000_000;
const account = { id: 'account', provider: 'github' as const, login: 'someone', displayName: null };
const deviceKey = generateKeyPairSync('ed25519');
const sessionKey = deviceKey.publicKey.export({ format: 'jwk' }).x!;
let db: D1Database;

const signedWith = (key: ReturnType<typeof generateKeyPairSync>, refreshToken: string, issuedAt = Date.now()): SessionRefreshPayload => ({
    refreshToken,
    issuedAt,
    signature: sign(null, Buffer.from(sessionRefreshMessage(refreshToken, issuedAt)), key.privateKey).toString('base64url')
});

const signed = (refreshToken: string, issuedAt = Date.now()): SessionRefreshPayload => signedWith(deviceKey, refreshToken, issuedAt);

const bearer = (token: string): Request => new Request('https://pulsar.test/v1/account', { headers: { authorization: `Bearer ${token}` } });

const rotated = (outcome: Awaited<ReturnType<typeof rotateSession>>): SessionResult => {
    if (outcome === null || outcome === 'clock-skew') {
        throw new Error(`Expected a rotation, got ${outcome}`);
    }
    return outcome;
};

beforeEach(() => {
    setSystemTime(new Date(NOW));
    const sqlite = migratedDatabase();
    sqlite.query('INSERT INTO account (id, provider, subject, created_at) VALUES (?, ?, ?, ?)').run('account', 'github', 'subject', NOW);
    sqlite
        .query('INSERT INTO identity (provider, subject, account_id, login, created_at) VALUES (?, ?, ?, ?, ?)')
        .run('github', 'subject', 'account', 'someone', NOW);
    db = d1(sqlite);
});

afterEach(() => {
    setSystemTime();
});

describe('a refresh whose answer got lost', () => {
    test('a retry with the spent token gets the same rotation back, and the session carries on', async () => {
        const session = await createSession(db, account, 'phone', sessionKey);
        const lost = rotated(await rotateSession(db, signed(session.refreshToken)));

        setSystemTime(new Date(NOW + 30_000));
        const again = rotated(await rotateSession(db, signed(session.refreshToken)));
        expect(again).toEqual(lost);
        expect(again.accessExpiresAt).toBe(NOW + ACCESS_LIFETIME_MS);
        expect(await authenticate(bearer(again.accessToken), db)).toMatchObject({ account: { id: 'account', login: 'someone' } });

        const next = rotated(await rotateSession(db, signed(again.refreshToken)));
        expect(next.refreshToken).not.toBe(again.refreshToken);
        expect(await authenticate(bearer(next.accessToken), db)).not.toBeNull();
    });

    test('two holders spending the same token at once end up with the same session', async () => {
        const session = await createSession(db, account, 'phone', sessionKey);
        const [first, second] = await Promise.all([rotateSession(db, signed(session.refreshToken)), rotateSession(db, signed(session.refreshToken))]);
        expect(rotated(second)).toEqual(rotated(first));
    });

    test('past the grace the spent token is reuse, and ends the session', async () => {
        const session = await createSession(db, account, 'phone', sessionKey);
        const lost = rotated(await rotateSession(db, signed(session.refreshToken)));

        setSystemTime(new Date(NOW + ROTATION_GRACE_MS + 1));
        expect(await rotateSession(db, signed(session.refreshToken))).toBeNull();
        expect(await rotateSession(db, signed(lost.refreshToken))).toBeNull();
    });

    test('a retry signed with another key gets nothing and ends nothing', async () => {
        const session = await createSession(db, account, 'phone', sessionKey);
        const lost = rotated(await rotateSession(db, signed(session.refreshToken)));
        expect(await rotateSession(db, signedWith(generateKeyPairSync('ed25519'), session.refreshToken))).toBeNull();
        expect(await authenticate(bearer(lost.accessToken), db)).not.toBeNull();
    });
});

describe('a refresh from a clock that is off', () => {
    test('is told so, and the session stays good for when the clock is right', async () => {
        const session = await createSession(db, account, 'phone', sessionKey);
        expect(await rotateSession(db, signed(session.refreshToken, NOW - 11 * 60_000))).toBe('clock-skew');
        expect(await rotateSession(db, signed(session.refreshToken, NOW + 11 * 60_000))).toBe('clock-skew');
        expect(rotated(await rotateSession(db, signed(session.refreshToken))).account.id).toBe('account');
    });

    test('the answer names the clock and how far off it is', async () => {
        const session = await createSession(db, account, 'phone', sessionKey);
        const request = new Request('https://pulsar.test/v1/session/refresh', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(signed(session.refreshToken, NOW - 11 * 60_000))
        });
        const response = await refreshSession(request, { DB: db } as Env);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            error: { code: 'clock-skew', message: 'The clock of this device is 11 minutes behind. Set it right and try again.' }
        });
    });
});
