import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { MAPS_TICKET_LIFETIME_MS, MapsTicketSchema, mapsTicketSubject, verifyMapsTicket, type MapsTicket } from '@ruimte/pulsar';
import type { Env } from './env.ts';
import { issueMapsTicket } from './maps-ticket.ts';
import { LIMITS } from './rate-limit.ts';
import { windowStartOf } from './rate-window.ts';
import { createSession } from './sessions.ts';
import { d1, migratedDatabase } from './test/sqlite-d1.ts';

interface Pair {
    publicKey: string;
    privateKey: KeyObject;
}

function newPair(): Pair {
    const keys = generateKeyPairSync('ed25519');
    return { publicKey: keys.publicKey.export({ format: 'jwk' }).x!, privateKey: keys.privateKey };
}

// 32 bytes in base64url, as `openssl rand -base64 32` spells them once made url safe.
const SECRET = 'rpEgLz0VDkQ2M4v1o9s3bYt7JfHaCwXn6iUeNy8PqKg';
const OTHER_SECRET = 'Zk3mQ8vJx1LpT5aRn0cWy7DbHfUe2GsOi9NtV4Xr6Ml';

// A second into a counting window, so the limit tests stand still inside one.
const NOW = windowStartOf(Date.UTC(2026, 9, 1)) + 1_000;

let sqlite: Database;
let env: Env;

async function signIn(accountId: string): Promise<string> {
    sqlite.query('INSERT INTO account (id, provider, subject, created_at) VALUES (?, ?, ?, ?)').run(accountId, 'github', accountId, NOW);
    const session = await createSession(env.DB, { id: accountId, provider: 'github', login: accountId, displayName: null }, 'laptop', newPair().publicKey);
    return session.accessToken;
}

function post(body: unknown, token?: string, ip = '192.0.2.1'): Request {
    return new Request('https://pulsar.test/v1/maps/ticket', {
        method: 'POST',
        headers: { 'cf-connecting-ip': ip, ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
        body: JSON.stringify(body)
    });
}

async function errorCode(response: Response): Promise<string> {
    return ((await response.json()) as { error: { code: string } }).error.code;
}

beforeEach(() => {
    setSystemTime(NOW);
    sqlite = migratedDatabase();
    env = { DB: d1(sqlite), PUBLIC_ORIGIN: 'https://pulsar.test', MAP_TICKET_SECRET: SECRET };
});

afterEach(() => {
    setSystemTime();
});

describe('a ticket for a signed-in client', () => {
    test('is good for an hour, names a digest of the account, and the secret verifies it', async () => {
        const token = await signIn('owner');
        const response = await issueMapsTicket(post({}, token), env);
        expect(response.status).toBe(200);
        const issued = MapsTicketSchema.parse(await response.json()) satisfies MapsTicket;
        expect(issued.issuedAt).toBe(NOW);
        expect(issued.expiresAt).toBe(NOW + MAPS_TICKET_LIFETIME_MS);
        const subject = await mapsTicketSubject(SECRET, 'owner');
        expect(await verifyMapsTicket(SECRET, issued.ticket, NOW)).toEqual({ subject, expiresAt: issued.expiresAt });
        expect(issued.ticket).not.toContain('owner');
        expect(await verifyMapsTicket(OTHER_SECRET, issued.ticket, NOW)).toBeNull();
        expect(await verifyMapsTicket(SECRET, issued.ticket, issued.expiresAt)).toBeNull();
    });

    test('is refused for a token the address book does not know, and for a request without one', async () => {
        const response = await issueMapsTicket(post({}, 'A'.repeat(43)), env);
        expect(response.status).toBe(401);
        expect(await errorCode(response)).toBe('unauthorized');
        expect(await errorCode(await issueMapsTicket(post({}), env))).toBe('unauthorized');
    });

    test('two clients of one account get a ticket for the same subject', async () => {
        const first = await signIn('owner');
        const second = await createSession(env.DB, { id: 'owner', provider: 'github', login: 'owner', displayName: null }, 'phone', newPair().publicKey);
        const one = MapsTicketSchema.parse(await (await issueMapsTicket(post({}, first), env)).json());
        const two = MapsTicketSchema.parse(await (await issueMapsTicket(post({}, second.accessToken), env)).json());
        expect(one.ticket.split('.')[0]).toBe(two.ticket.split('.')[0]);
    });
});

describe('without the secret or past the limits', () => {
    test('the address book says it issues no tickets, and signs nothing', async () => {
        const token = await signIn('owner');
        const response = await issueMapsTicket(post({}, token), { ...env, MAP_TICKET_SECRET: undefined });
        expect(response.status).toBe(503);
        expect(await errorCode(response)).toBe('not-configured');
        expect((await issueMapsTicket(post({}, token), { ...env, MAP_TICKET_SECRET: '' })).status).toBe(503);
    });

    test('a secret that is not 32 bytes of base64url is as good as none', async () => {
        const token = await signIn('owner');
        for (const secret of ['short', 'a'.repeat(42), `${SECRET}!`, 'the shared maps secret of the maps service']) {
            const response = await issueMapsTicket(post({}, token), { ...env, MAP_TICKET_SECRET: secret });
            expect(response.status).toBe(503);
            expect(await errorCode(response)).toBe('not-configured');
        }
    });

    test('an account is limited per minute, and the answer says when to try again', async () => {
        const token = await signIn('owner');
        for (let i = 0; i < LIMITS.mapsTicketAccount; i++) {
            expect((await issueMapsTicket(post({}, token, `192.0.2.${i + 10}`), env)).status).toBe(200);
        }
        const limited = await issueMapsTicket(post({}, token, '192.0.2.99'), env);
        expect(limited.status).toBe(429);
        expect(limited.headers.get('retry-after')).not.toBeNull();
    });

    test('an address is limited per minute even when its requests fail', async () => {
        for (let i = 0; i < LIMITS.mapsTicketIp; i++) {
            expect((await issueMapsTicket(post({}, 'A'.repeat(43)), env)).status).toBe(401);
        }
        expect((await issueMapsTicket(post({}, 'A'.repeat(43)), env)).status).toBe(429);
    });
});
