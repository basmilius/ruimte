import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import type { Env } from './env.ts';
import { resolveAccount, unlinkIdentity } from './identities.ts';
import { createSession } from './sessions.ts';
import { d1, migratedDatabase } from './test/sqlite-d1.ts';

const NOW = 1_900_000_000_000;
const account = { id: 'account', provider: 'github' as const, login: 'someone', displayName: null };
const sessionKey = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x!;
let sqlite: Database;
let db: D1Database;

interface Statement {
    bind(...values: unknown[]): Statement;
    first(): Promise<unknown>;
    run(): Promise<unknown>;
    all(): Promise<unknown>;
    batched(): unknown;
}

/* A database that runs `before` ahead of every round trip, the way another request lands between two of them. */
function interleaved(inner: D1Database, before: () => Promise<void>): D1Database {
    const wrap = (statement: Statement): Statement => ({
        bind: (...values) => wrap(statement.bind(...values)),
        first: async () => {
            await before();
            return statement.first();
        },
        run: async () => {
            await before();
            return statement.run();
        },
        all: async () => {
            await before();
            return statement.all();
        },
        batched: () => statement.batched()
    });
    return {
        prepare: (sql: string) => wrap(inner.prepare(sql) as unknown as Statement),
        batch: async (statements: Parameters<D1Database['batch']>[0]) => {
            await before();
            return inner.batch(statements);
        }
    } as unknown as D1Database;
}

async function unlink(database: D1Database, provider: string): Promise<Response> {
    const session = await createSession(db, account, 'laptop', sessionKey);
    const request = new Request(`https://pulsar.test/v1/account/identities/${provider}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${session.accessToken}` }
    });
    return unlinkIdentity(request, { DB: database } as Env, provider);
}

function subjectOfAccount(): string {
    return (sqlite.query("SELECT subject FROM account WHERE id = 'account'").get() as { subject: string }).subject;
}

beforeEach(() => {
    sqlite = migratedDatabase();
    sqlite.query('INSERT INTO account (id, provider, subject, created_at) VALUES (?, ?, ?, ?)').run('account', 'github', 'github-subject', NOW);
    sqlite
        .query('INSERT INTO identity (provider, subject, account_id, login, created_at) VALUES (?, ?, ?, ?, ?)')
        .run('github', 'github-subject', 'account', 'someone', NOW);
    db = d1(sqlite);
});

describe('removing an identity', () => {
    test('a sign-in with the identity between any two round trips never links it back to the account', async () => {
        sqlite
            .query('INSERT INTO identity (provider, subject, account_id, login, created_at) VALUES (?, ?, ?, ?, ?)')
            .run('apple', 'apple-subject', 'account', null, NOW);
        const signIn = async () => {
            await resolveAccount(db, 'github', { subject: 'github-subject', login: 'someone', displayName: null }, NOW);
        };
        const response = await unlink(interleaved(db, signIn), 'github');
        expect(response.status).toBe(200);
        const owner = sqlite.query("SELECT account_id FROM identity WHERE provider = 'github' AND subject = 'github-subject'").get() as {
            account_id: string;
        } | null;
        expect(owner?.account_id).not.toBe('account');
        expect(subjectOfAccount()).toBe('unlinked:account');
    });

    test('the last identity stays, and so does the subject of the account', async () => {
        const response = await unlink(db, 'github');
        expect(response.status).toBe(409);
        expect(sqlite.query("SELECT COUNT(*) AS count FROM identity WHERE account_id = 'account'").get()).toEqual({ count: 1 });
        expect(subjectOfAccount()).toBe('github-subject');
    });

    test('an identity the account was not made with comes off without touching its subject', async () => {
        sqlite
            .query('INSERT INTO identity (provider, subject, account_id, login, created_at) VALUES (?, ?, ?, ?, ?)')
            .run('apple', 'apple-subject', 'account', null, NOW);
        expect((await unlink(db, 'apple')).status).toBe(200);
        expect(subjectOfAccount()).toBe('github-subject');
        expect((await unlink(db, 'apple')).status).toBe(404);
    });
});
