import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pushMessage, type PushEnvelope } from '@ruimte/pulsar';
import type { Env } from './env.ts';
import { changePushDevice, registerPushDevice, sendPush, type PushDeliverySeams } from './push.ts';
import { apnsPayload, deliverApns } from './apns.ts';

const NOW = 1_900_000_000_000;
const access = 'a'.repeat(43);
const handle = 'h'.repeat(43);
const machineKey = generateKeyPairSync('ed25519');
const machinePublicKey = machineKey.publicKey.export({ format: 'jwk' }).x!;
let sqlite: Database;
let env: Env;
let delivered: PushEnvelope[];
let seams: PushDeliverySeams;

// The route executes its real SQL on SQLite; only the D1 transport is adapted.
const d1 = (database: Database): D1Database =>
    ({
        prepare(sql: string) {
            const query = (values: unknown[] = []) => ({
                bind(...bound: unknown[]) {
                    return query(bound);
                },
                async first() {
                    return database.query(sql).get(...(values as never[])) ?? null;
                },
                async run() {
                    const result = database.query(sql).run(...(values as never[]));
                    return { meta: { changes: result.changes }, success: true };
                },
                async all() {
                    return { results: database.query(sql).all(...(values as never[])), success: true };
                }
            });
            return query();
        }
    }) as unknown as D1Database;

const request = (body: unknown, method = 'POST', token = access): Request =>
    new Request('https://pulsar.test/v1/push', {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(method === 'DELETE' ? {} : { body: JSON.stringify(body) })
    });
const signed = (changes: Partial<PushEnvelope> = {}): PushEnvelope => {
    const push: PushEnvelope = {
        machineId: 'machine',
        handle,
        id: randomBytes(32).toString('base64url'),
        issuedAt: NOW,
        expiresAt: NOW + 110_000,
        collapseId: 'c'.repeat(43),
        pushType: 'alert',
        ephemeralKey: 'e'.repeat(43),
        nonce: 'n'.repeat(16),
        ciphertext: 'a'.repeat(22),
        signature: '',
        ...changes
    } as PushEnvelope;
    push.signature = sign(null, Buffer.from(pushMessage(push)), machineKey.privateKey).toString('base64url');
    return push;
};

beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON');
    const migrations = join(import.meta.dir, '../migrations');
    for (const file of readdirSync(migrations).sort()) {
        sqlite.exec(readFileSync(join(migrations, file), 'utf8'));
    }
    sqlite.query('INSERT INTO account (id, provider, subject, created_at) VALUES (?, ?, ?, ?)').run('account', 'github', 'subject', NOW);
    sqlite
        .query('INSERT INTO session (id, account_id, access_hash, access_expires_at, refresh_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('session', 'account', createHash('sha256').update(access).digest('base64url'), Number.MAX_SAFE_INTEGER, 'refresh', Number.MAX_SAFE_INTEGER, NOW);
    sqlite
        .query('INSERT INTO machine (account_id, id, name, public_key, created_at) VALUES (?, ?, ?, ?, ?)')
        .run('account', 'machine', 'Computer', machinePublicKey, NOW);
    sqlite
        .query('INSERT INTO push_device (handle, account_id, session_id, token, environment, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(handle, 'account', 'session', 'ab'.repeat(32), 'sandbox', NOW);
    env = {
        DB: d1(sqlite),
        PUBLIC_ORIGIN: 'https://pulsar.test',
        APNS_KEY: 'injected',
        APNS_KEY_ID: 'test',
        APNS_TEAM_ID: 'test',
        APNS_TOPIC: 'app.ruimte.mobile'
    };
    delivered = [];
    seams = {
        now: () => NOW,
        send: async (_env, _target, push) => {
            delivered.push(push);
            return { ok: true, status: 200 };
        }
    };
});

afterEach(() => {
    sqlite.close();
});

describe('push authorization and routing', () => {
    test('device registration rotates tokens without moving the session-bound handle', async () => {
        const response = await registerPushDevice(request({ token: 'cd'.repeat(32), environment: 'sandbox' }), env);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ handle });
        expect(sqlite.query('SELECT token FROM push_device').get()).toEqual({ token: 'cd'.repeat(32) });
        expect((await registerPushDevice(request({ token: 'cd'.repeat(32), environment: 'sandbox' }, 'POST', 'b'.repeat(43)), env)).status).toBe(401);
    });

    test('only the registering session can change or delete activity/device tokens', async () => {
        const collapseId = 'c'.repeat(43);
        expect((await changePushDevice(request({ machineId: 'machine', collapseId, token: 'ef'.repeat(32) }, 'PUT'), env, handle, 'update')).status).toBe(204);
        expect((await changePushDevice(request({ token: 'ab'.repeat(32) }, 'PUT'), env, handle, 'start')).status).toBe(204);
        expect(sqlite.query('SELECT token FROM push_activity').get()).toEqual({ token: 'ef'.repeat(32) });
        const otherAccess = 'b'.repeat(43);
        sqlite
            .query('INSERT INTO session (id, account_id, access_hash, access_expires_at, refresh_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(
                'other',
                'account',
                createHash('sha256').update(otherAccess).digest('base64url'),
                Number.MAX_SAFE_INTEGER,
                'refresh-other',
                Number.MAX_SAFE_INTEGER,
                NOW
            );
        expect(
            (await changePushDevice(request({ machineId: 'machine', collapseId, token: 'aa'.repeat(32) }, 'PUT', otherAccess), env, handle, 'update')).status
        ).toBe(404);
        expect((await changePushDevice(request(null, 'DELETE', otherAccess), env, handle, null)).status).toBe(404);
        expect((await changePushDevice(request(null, 'DELETE'), env, handle, null)).status).toBe(204);
        expect(sqlite.query('SELECT * FROM push_activity').all()).toEqual([]);
    });

    test('signatures bind every routing and ciphertext field and replays deliver only once', async () => {
        const push = signed();
        expect((await sendPush(request({ ...push, ciphertext: 'z'.repeat(22) }), env, seams)).status).toBe(403);
        expect((await sendPush(request(push), env, seams)).status).toBe(204);
        expect((await sendPush(request(push), env, seams)).status).toBe(400);
        expect(delivered).toEqual([push]);
    });

    test('revoked sessions, expired sessions, foreign accounts and removed machines cannot receive', async () => {
        sqlite.query('UPDATE session SET revoked_at = ?').run(NOW);
        expect((await sendPush(request(signed()), env, seams)).status).toBe(401);
        sqlite.query('UPDATE session SET revoked_at = NULL, expires_at = ?').run(NOW - 1);
        expect((await sendPush(request(signed()), env, seams)).status).toBe(401);
        sqlite.query('UPDATE session SET expires_at = ?').run(Number.MAX_SAFE_INTEGER);
        sqlite.query('INSERT INTO account (id, provider, subject, created_at) VALUES (?, ?, ?, ?)').run('foreign', 'github', 'foreign-subject', NOW);
        sqlite.query('UPDATE push_device SET account_id = ?').run('foreign');
        expect((await sendPush(request(signed()), env, seams)).status).toBe(401);
        sqlite.query('UPDATE push_device SET account_id = ?').run('account');
        sqlite.query('DELETE FROM machine').run();
        expect((await sendPush(request(signed()), env, seams)).status).toBe(401);
        expect(delivered).toEqual([]);
    });

    test('old/future/expired or overlong validity windows are refused', async () => {
        for (const changes of [{ expiresAt: NOW }, { issuedAt: NOW + 31_000 }, { issuedAt: NOW - 121_000 }, { expiresAt: NOW + 121_000 }]) {
            expect((await sendPush(request(signed(changes)), env, seams)).status).toBe(400);
        }
        expect(delivered).toEqual([]);
    });

    test('handle and machine rates remain bounded across requests', async () => {
        for (let i = 0; i < 60; i++) {
            expect((await sendPush(request(signed()), env, seams)).status).toBe(204);
        }
        expect((await sendPush(request(signed()), env, seams)).status).toBe(429);
        expect(delivered.length).toBe(60);
    });

    test('missing APNs configuration never sends and an unregistered token is deleted', async () => {
        expect((await sendPush(request(signed()), { ...env, APNS_KEY: undefined }, seams)).status).toBe(503);
        expect(delivered).toEqual([]);
        await sendPush(request(signed()), env, { ...seams, send: async () => ({ ok: false, status: 410 }) });
        expect(sqlite.query('SELECT handle FROM push_device').all()).toEqual([]);
    });

    test('distinct phase updates cannot start duplicate activities before an update token arrives', async () => {
        sqlite.query('UPDATE push_device SET start_token = ?').run('ef'.repeat(32));
        const activity = { title: 'Build', phase: 'running' as const, startedAt: NOW };
        expect((await sendPush(request(signed({ pushType: 'liveactivity', activity } as Partial<PushEnvelope>)), env, seams)).status).toBe(204);
        expect(
            (await sendPush(request(signed({ pushType: 'liveactivity', activity: { ...activity, phase: 'tool' } } as Partial<PushEnvelope>)), env, seams))
                .status
        ).toBe(204);
        expect(delivered.length).toBe(1);
    });

    test('another machine cannot update an activity even when it knows its collapse id', async () => {
        sqlite
            .query('INSERT INTO machine (account_id, id, name, public_key, created_at) VALUES (?, ?, ?, ?, ?)')
            .run('account', 'other-machine', 'Other', machinePublicKey, NOW);
        sqlite
            .query('INSERT INTO push_activity (handle, collapse_id, token, updated_at, machine_id) VALUES (?, ?, ?, ?, ?)')
            .run(handle, 'c'.repeat(43), 'ef'.repeat(32), NOW, 'machine');
        const push = signed({
            machineId: 'other-machine',
            pushType: 'liveactivity',
            activity: { title: 'Wrong machine', phase: 'running', startedAt: NOW }
        } as Partial<PushEnvelope>);
        expect((await sendPush(request(push), env, seams)).status).toBe(404);
        expect(delivered).toEqual([]);
    });

    test('live activities select update tokens and only approved content goes to APNs', async () => {
        sqlite
            .query('INSERT INTO push_activity (handle, collapse_id, token, updated_at, machine_id) VALUES (?, ?, ?, ?, ?)')
            .run(handle, 'c'.repeat(43), 'ef'.repeat(32), NOW, 'machine');
        const push = signed({ pushType: 'liveactivity', activity: { title: 'Build app', phase: 'done', startedAt: NOW - 10_000 } } as Partial<PushEnvelope>);
        let selected: unknown;
        expect(
            (
                await sendPush(request(push), env, {
                    ...seams,
                    send: async (_env, target) => {
                        selected = target;
                        return { ok: true, status: 200 };
                    }
                })
            ).status
        ).toBe(204);
        expect(selected).toEqual({ token: 'ef'.repeat(32), environment: 'sandbox', startsActivity: false });
        expect(apnsPayload(push, false)).toMatchObject({
            aps: { event: 'end', 'content-state': { title: 'Build app', phase: 'done', startedAt: NOW - 10_000 }, 'dismissal-date': NOW / 1000 + 900 }
        });
    });
});

test('APNs provider signs with the configured topic and environment, and enforces the 4 KB payload', async () => {
    const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const apnsEnv = { ...env, APNS_KEY: key };
    let called: { url: string; headers: Headers; body: string } | null = null;
    const send = (async (url: string | URL | Request, init?: RequestInit) => {
        called = { url: String(url), headers: new Headers(init?.headers), body: String(init?.body) };
        return new Response(null, { status: 200 });
    }) as typeof fetch;
    expect(await deliverApns(apnsEnv, { token: 'ab'.repeat(32), environment: 'sandbox', startsActivity: false }, signed(), NOW, send)).toEqual({
        ok: true,
        status: 200
    });
    expect(called!.url).toStartWith('https://api.sandbox.push.apple.com/3/device/');
    expect(called!.headers.get('apns-topic')).toBe('app.ruimte.mobile');
    expect(called!.headers.get('apns-push-type')).toBe('alert');
    expect(called!.headers.get('authorization')).toStartWith('bearer ey');
    expect(JSON.parse(called!.body).aps['mutable-content']).toBe(1);
    expect(
        await deliverApns(
            apnsEnv,
            { token: 'ab'.repeat(32), environment: 'production', startsActivity: false },
            signed({ ciphertext: 'a'.repeat(5000) }),
            NOW,
            send
        )
    ).toEqual({ ok: false, status: 413 });
});
