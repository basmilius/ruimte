import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, sign, verify, type KeyObject } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    PULSAR_STATEMENT_PUBLIC_KEYS,
    accessRequestMessage,
    accessStatementMessage,
    machineRegistrationMessage,
    type AccessStatement,
    type AddressBookError,
    type MachineListResult,
    type SessionResult
} from '@ruimte/pulsar';
import { Miniflare } from 'miniflare';

/*
 * The Worker bundled the way wrangler would, in workerd through Miniflare, against an in-memory D1
 * with the real migrations. GitHub is the outbound service: nothing leaves the process.
 */

const APP_ROOT = join(import.meta.dir, '..');
const PUBLIC_ORIGIN = 'https://pulsar.test';
const REDIRECT_URI = 'http://127.0.0.1:53682/pulsar/callback';
const GITHUB_SECRET = 'github-secret';

const base64url = (bytes: Buffer): string => bytes.toString('base64url');
const sha256 = (text: string): string => base64url(createHash('sha256').update(text).digest());

interface KeyPair {
    publicKey: string;
    privateKey: KeyObject;
}

const newKeyPair = (): KeyPair => {
    const pair = generateKeyPairSync('ed25519');
    return { publicKey: pair.publicKey.export({ format: 'jwk' }).x ?? '', privateKey: pair.privateKey };
};

const signWith = (pair: KeyPair, message: string): string => base64url(sign(null, Buffer.from(message), pair.privateKey));

const verifies = (publicKey: string, message: string, signature: string): boolean =>
    verify(
        null,
        Buffer.from(message),
        createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' }),
        Buffer.from(signature, 'base64url')
    );

// With the real secret in the environment the pinned key is checked too; without it a throwaway pair stands in.
const realStatementSecret = process.env.PULSAR_STATEMENT_PRIVATE_KEY;
const testStatementPair = generateKeyPairSync('ed25519');
const statementSecret = realStatementSecret ?? base64url(testStatementPair.privateKey.export({ format: 'der', type: 'pkcs8' }));
const statementPublicKey = realStatementSecret ? (PULSAR_STATEMENT_PUBLIC_KEYS[0] ?? '') : (testStatementPair.publicKey.export({ format: 'jwk' }).x ?? '');

const bundle = async (): Promise<string> => {
    const result = await Bun.build({ entrypoints: [join(APP_ROOT, 'src/index.ts')], target: 'browser', format: 'esm' });
    const output = result.outputs[0];
    if (!result.success || !output) {
        throw new Error(`The worker did not bundle: ${result.logs.join('\n')}`);
    }
    return output.text();
};

const migrate = async (mf: Miniflare): Promise<void> => {
    const db = await mf.getD1Database('DB');
    const folder = join(APP_ROOT, 'migrations');
    for (const file of readdirSync(folder).sort()) {
        const sql = readFileSync(join(folder, file), 'utf8')
            .split('\n')
            .filter((line) => !line.trim().startsWith('--'))
            .join('\n');
        for (const statement of sql.split(';').map((part) => part.trim())) {
            if (statement.length > 0) {
                await db.prepare(statement).run();
            }
        }
    }
};

// A code GitHub handed out, with the challenge the address book sent along, so the mock checks PKCE the way GitHub does.
const githubCodes = new Map<string, { userId: number; challenge: string }>();
const githubTokens = new Map<string, number>();

const github = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.href === 'https://github.com/login/oauth/access_token') {
        const form = new URLSearchParams(await request.text());
        const code = form.get('code') ?? '';
        const entry = githubCodes.get(code);
        githubCodes.delete(code);
        if (
            !entry ||
            form.get('client_secret') !== GITHUB_SECRET ||
            form.get('redirect_uri') !== `${PUBLIC_ORIGIN}/auth/github/callback` ||
            sha256(form.get('code_verifier') ?? '') !== entry.challenge
        ) {
            return Response.json({ error: 'bad_verification_code' });
        }
        const token = randomBytes(16).toString('hex');
        githubTokens.set(token, entry.userId);
        return Response.json({ access_token: token, token_type: 'bearer' });
    }
    if (url.href === 'https://api.github.com/user') {
        const userId = githubTokens.get((request.headers.get('authorization') ?? '').replace('Bearer ', ''));
        return userId ? Response.json({ id: userId, login: `user-${userId}` }) : Response.json({ message: 'Bad credentials' }, { status: 401 });
    }
    return new Response(`unexpected outbound request to ${url.href}`, { status: 599 });
};

let script = '';
let mf: Miniflare;
let ipCounter = 0;

// Every flow gets an address of its own, so one test never spends another's rate limit.
const nextIp = (): string => `192.0.2.${++ipCounter}`;

const dispatch = async (path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown; ip?: string } = {}): Promise<Response> => {
    const headers: Record<string, string> = { 'cf-connecting-ip': init.ip ?? nextIp(), ...init.headers };
    if (init.body !== undefined) {
        headers['content-type'] = 'application/json';
    }
    const response = await mf.dispatchFetch(`${PUBLIC_ORIGIN}${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        redirect: 'manual'
    });
    return response as unknown as Response;
};

const bearer = (session: SessionResult): Record<string, string> => ({ authorization: `Bearer ${session.accessToken}` });

interface LoginStart {
    verifier: string;
    appState: string;
    cookie: string;
    providerState: string;
    providerChallenge: string;
    ip: string;
}

const startLogin = async (): Promise<LoginStart> => {
    const verifier = base64url(randomBytes(32));
    const appState = base64url(randomBytes(16));
    const ip = nextIp();
    const query = new URLSearchParams({ redirect_uri: REDIRECT_URI, state: appState, code_challenge: sha256(verifier), code_challenge_method: 'S256' });
    const response = await dispatch(`/auth/github/start?${query}`, { ip });
    expect(response.status).toBe(302);
    const authorize = new URL(response.headers.get('location') ?? '');
    expect(authorize.origin + authorize.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    return {
        verifier,
        appState,
        cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
        providerState: authorize.searchParams.get('state') ?? '',
        providerChallenge: authorize.searchParams.get('code_challenge') ?? '',
        ip
    };
};

// GitHub sending the browser back; answers the redirect to the app.
const githubCallback = async (start: LoginStart, userId: number, cookie = start.cookie): Promise<Response> => {
    const code = randomBytes(8).toString('hex');
    githubCodes.set(code, { userId, challenge: start.providerChallenge });
    return dispatch(`/auth/github/callback?${new URLSearchParams({ code, state: start.providerState })}`, { headers: { cookie }, ip: start.ip });
};

const signIn = async (userId: number): Promise<SessionResult> => {
    const start = await startLogin();
    const callback = await githubCallback(start, userId);
    expect(callback.status).toBe(302);
    const back = new URL(callback.headers.get('location') ?? '');
    expect(back.searchParams.get('state')).toBe(start.appState);
    const response = await dispatch('/v1/session', {
        method: 'POST',
        body: { code: back.searchParams.get('code'), codeVerifier: start.verifier, redirectUri: REDIRECT_URI, label: 'Test device' },
        ip: start.ip
    });
    expect(response.status).toBe(200);
    return (await response.json()) as SessionResult;
};

const registration = (session: SessionResult, machine: KeyPair, id: string, accountId = session.account.id, signer = machine) => {
    const issuedAt = Date.now();
    const name = `Machine ${id}`;
    return {
        id,
        name,
        icon: { kind: 'lucide', value: 'server' },
        publicKey: machine.publicKey,
        issuedAt,
        signature: signWith(signer, machineRegistrationMessage(accountId, id, machine.publicKey, name, issuedAt))
    };
};

const accessRequest = (machineId: string, client: KeyPair, signer = client) => {
    const nonce = base64url(randomBytes(16));
    return { machineId, clientPublicKey: client.publicKey, nonce, signature: signWith(signer, accessRequestMessage(machineId, client.publicKey, nonce)) };
};

const errorCode = async (response: Response): Promise<string> => ((await response.json()) as AddressBookError).error.code;

beforeAll(async () => {
    script = await bundle();
    mf = new Miniflare({
        modules: true,
        script,
        compatibilityDate: '2026-08-01',
        d1Databases: { DB: 'pulsar-test' },
        bindings: {
            PUBLIC_ORIGIN,
            ALLOWED_ORIGINS: 'https://app.example.com',
            GITHUB_CLIENT_ID: 'github-client',
            GITHUB_CLIENT_SECRET: GITHUB_SECRET,
            STATEMENT_PRIVATE_KEY: statementSecret
        },
        outboundService: github
    });
    await migrate(mf);
}, 30_000);

afterAll(async () => {
    await mf.dispose();
});

describe('health', () => {
    test('names the statement key and the providers that are configured', async () => {
        const response = await dispatch('/health');
        expect(await response.json()).toEqual({ ok: true, statementKey: statementPublicKey, providers: { github: true } });
    });
});

describe('login', () => {
    test('a whole login ends in a session for the GitHub user id', async () => {
        const session = await signIn(1001);
        expect(session.account.provider).toBe('github');
        expect(session.account.login).toBe('user-1001');
        const again = await signIn(1001);
        expect(again.account.id).toBe(session.account.id);
        expect(again.accessToken).not.toBe(session.accessToken);
    });

    test('refuses to send the browser anywhere but the app', async () => {
        const query = new URLSearchParams({
            redirect_uri: 'https://evil.example.com/pulsar/callback',
            state: base64url(randomBytes(16)),
            code_challenge: sha256('x'.repeat(43)),
            code_challenge_method: 'S256'
        });
        const response = await dispatch(`/auth/github/start?${query}`);
        expect(response.status).toBe(400);
        expect(await errorCode(response)).toBe('bad-request');
    });

    test('refuses a start without S256', async () => {
        const query = new URLSearchParams({
            redirect_uri: REDIRECT_URI,
            state: base64url(randomBytes(16)),
            code_challenge: sha256('x'.repeat(43)),
            code_challenge_method: 'plain'
        });
        expect((await dispatch(`/auth/github/start?${query}`)).status).toBe(400);
    });

    test('a callback with a state the address book never handed out is refused', async () => {
        const start = await startLogin();
        const response = await githubCallback({ ...start, providerState: base64url(randomBytes(32)) }, 1002);
        expect(response.status).toBe(400);
        expect(response.headers.get('location')).toBeNull();
    });

    test('a callback in another browser is refused, and spends the state', async () => {
        const start = await startLogin();
        const elsewhere = await githubCallback(start, 1003, '__Host-pulsar-login=someone-else');
        expect(elsewhere.status).toBe(400);
        const retried = await githubCallback(start, 1003);
        expect(retried.status).toBe(400);
    });

    test('a state is good for one callback', async () => {
        const start = await startLogin();
        expect((await githubCallback(start, 1004)).status).toBe(302);
        expect((await githubCallback(start, 1004)).status).toBe(400);
    });

    test('a provider that refuses the code sends the app an error with its state', async () => {
        const start = await startLogin();
        // No code registered with the mock, so GitHub answers bad_verification_code.
        const response = await dispatch(`/auth/github/callback?${new URLSearchParams({ code: 'unknown', state: start.providerState })}`, {
            headers: { cookie: start.cookie },
            ip: start.ip
        });
        const back = new URL(response.headers.get('location') ?? '');
        expect(back.href.startsWith(REDIRECT_URI)).toBe(true);
        expect(back.searchParams.get('error')).toBe('server_error');
        expect(back.searchParams.get('state')).toBe(start.appState);
        expect(back.searchParams.get('code')).toBeNull();
    });

    test('the code is worth nothing without the verifier, and a wrong verifier spends it', async () => {
        const start = await startLogin();
        const back = new URL((await githubCallback(start, 1005)).headers.get('location') ?? '');
        const code = back.searchParams.get('code');
        const wrong = await dispatch('/v1/session', {
            method: 'POST',
            body: { code, codeVerifier: base64url(randomBytes(32)), redirectUri: REDIRECT_URI },
            ip: start.ip
        });
        expect(wrong.status).toBe(401);
        const right = await dispatch('/v1/session', { method: 'POST', body: { code, codeVerifier: start.verifier, redirectUri: REDIRECT_URI }, ip: start.ip });
        expect(right.status).toBe(401);
    });

    test('the code is refused for another redirect than the one the login started with', async () => {
        const start = await startLogin();
        const back = new URL((await githubCallback(start, 1006)).headers.get('location') ?? '');
        const response = await dispatch('/v1/session', {
            method: 'POST',
            body: { code: back.searchParams.get('code'), codeVerifier: start.verifier, redirectUri: 'http://127.0.0.1:9999/pulsar/callback' },
            ip: start.ip
        });
        expect(response.status).toBe(401);
    });
});

describe('sessions', () => {
    test('a refresh rotates both tokens, and a spent refresh token ends the session', async () => {
        const session = await signIn(2001);
        const refreshed = await dispatch('/v1/session/refresh', { method: 'POST', body: { refreshToken: session.refreshToken } });
        expect(refreshed.status).toBe(200);
        const next = (await refreshed.json()) as SessionResult;
        expect(next.refreshToken).not.toBe(session.refreshToken);
        expect((await dispatch('/v1/machines', { headers: bearer(session) })).status).toBe(401);
        expect((await dispatch('/v1/machines', { headers: bearer(next) })).status).toBe(200);

        const replay = await dispatch('/v1/session/refresh', { method: 'POST', body: { refreshToken: session.refreshToken } });
        expect(replay.status).toBe(401);
        expect((await dispatch('/v1/machines', { headers: bearer(next) })).status).toBe(401);
        expect((await dispatch('/v1/session/refresh', { method: 'POST', body: { refreshToken: next.refreshToken } })).status).toBe(401);
    });

    test('signing out revokes the session', async () => {
        const session = await signIn(2002);
        expect((await dispatch('/v1/session', { method: 'DELETE', headers: bearer(session) })).status).toBe(204);
        expect((await dispatch('/v1/machines', { headers: bearer(session) })).status).toBe(401);
        expect((await dispatch('/v1/session/refresh', { method: 'POST', body: { refreshToken: session.refreshToken } })).status).toBe(401);
    });
});

describe('machines', () => {
    test('a machine that signed for this account is listed, and can be taken off the list', async () => {
        const session = await signIn(3001);
        const machine = newKeyPair();
        const registered = await dispatch('/v1/machines', { method: 'POST', headers: bearer(session), body: registration(session, machine, 'studio') });
        expect(registered.status).toBe(200);
        const list = (await (await dispatch('/v1/machines', { headers: bearer(session) })).json()) as MachineListResult;
        expect(list.machines).toHaveLength(1);
        expect(list.machines[0]).toMatchObject({
            id: 'studio',
            name: 'Machine studio',
            icon: { kind: 'lucide', value: 'server' },
            publicKey: machine.publicKey
        });

        expect((await dispatch('/v1/machines/studio', { method: 'DELETE', headers: bearer(session) })).status).toBe(204);
        expect((await dispatch('/v1/machines/studio', { method: 'DELETE', headers: bearer(session) })).status).toBe(404);
        const empty = (await (await dispatch('/v1/machines', { headers: bearer(session) })).json()) as MachineListResult;
        expect(empty.machines).toHaveLength(0);
    });

    test('a registration with a wrong signature is refused', async () => {
        const session = await signIn(3002);
        const machine = newKeyPair();
        const forged = await dispatch('/v1/machines', {
            method: 'POST',
            headers: bearer(session),
            body: registration(session, machine, 'forged', session.account.id, newKeyPair())
        });
        expect(forged.status).toBe(403);
        expect(await errorCode(forged)).toBe('bad-signature');

        const forAnotherAccount = await dispatch('/v1/machines', {
            method: 'POST',
            headers: bearer(session),
            body: registration(session, machine, 'elsewhere', 'another-account')
        });
        expect(forAnotherAccount.status).toBe(403);

        const list = (await (await dispatch('/v1/machines', { headers: bearer(session) })).json()) as MachineListResult;
        expect(list.machines).toHaveLength(0);
    });

    test('a registration signed long ago is refused', async () => {
        const session = await signIn(3003);
        const machine = newKeyPair();
        const issuedAt = Date.now() - 3_600_000;
        const body = {
            id: 'old',
            name: 'Old',
            icon: null,
            publicKey: machine.publicKey,
            issuedAt,
            signature: signWith(machine, machineRegistrationMessage(session.account.id, 'old', machine.publicKey, 'Old', issuedAt))
        };
        expect((await dispatch('/v1/machines', { method: 'POST', headers: bearer(session), body })).status).toBe(400);
    });

    test('nothing without a session', async () => {
        expect((await dispatch('/v1/machines')).status).toBe(401);
        expect((await dispatch('/v1/machines', { headers: { authorization: `Bearer ${base64url(randomBytes(32))}` } })).status).toBe(401);
    });
});

describe('statements', () => {
    test('a statement names the machine, the key and the nonce, lasts two minutes, verifies and is logged', async () => {
        const session = await signIn(4001);
        const machine = newKeyPair();
        await dispatch('/v1/machines', { method: 'POST', headers: bearer(session), body: registration(session, machine, 'studio') });
        const client = newKeyPair();
        const request = accessRequest('studio', client);
        const response = await dispatch('/v1/statements', { method: 'POST', headers: bearer(session), body: request });
        expect(response.status).toBe(200);
        const statement = (await response.json()) as AccessStatement;
        expect(statement).toMatchObject({ machineId: 'studio', clientPublicKey: client.publicKey, nonce: request.nonce });
        expect(statement.expiresAt - statement.issuedAt).toBe(120_000);
        const message = accessStatementMessage(statement.machineId, statement.clientPublicKey, statement.nonce, statement.issuedAt, statement.expiresAt);
        expect(verifies(statementPublicKey, message, statement.signature)).toBe(true);
        expect(verifies(machine.publicKey, message, statement.signature)).toBe(false);

        const db = await mf.getD1Database('DB');
        const log = await db.prepare('SELECT machine_id, device_public_key FROM statement_log WHERE account_id = ?1').bind(session.account.id).all();
        expect(log.results).toEqual([{ machine_id: 'studio', device_public_key: client.publicKey }]);
        const device = await db
            .prepare('SELECT label FROM device WHERE account_id = ?1 AND public_key = ?2')
            .bind(session.account.id, client.publicKey)
            .first();
        expect(device).toEqual({ label: 'Test device' });
    });

    test.skipIf(!realStatementSecret)('a statement verifies against the pinned public key', async () => {
        const session = await signIn(4002);
        await dispatch('/v1/machines', { method: 'POST', headers: bearer(session), body: registration(session, newKeyPair(), 'pinned') });
        const statement = (await (
            await dispatch('/v1/statements', { method: 'POST', headers: bearer(session), body: accessRequest('pinned', newKeyPair()) })
        ).json()) as AccessStatement;
        const message = accessStatementMessage(statement.machineId, statement.clientPublicKey, statement.nonce, statement.issuedAt, statement.expiresAt);
        expect(PULSAR_STATEMENT_PUBLIC_KEYS.some((key) => verifies(key, message, statement.signature))).toBe(true);
    });

    test('a statement for a machine on another account is refused', async () => {
        const owner = await signIn(4003);
        const stranger = await signIn(4004);
        await dispatch('/v1/machines', { method: 'POST', headers: bearer(owner), body: registration(owner, newKeyPair(), 'owned') });
        const response = await dispatch('/v1/statements', { method: 'POST', headers: bearer(stranger), body: accessRequest('owned', newKeyPair()) });
        expect(response.status).toBe(404);
        expect(await errorCode(response)).toBe('not-found');
        const db = await mf.getD1Database('DB');
        const logged = await db
            .prepare('SELECT COUNT(*) AS count FROM statement_log WHERE account_id = ?1')
            .bind(stranger.account.id)
            .first<{ count: number }>();
        expect(logged?.count).toBe(0);
    });

    test('a request not signed by the key it names is refused', async () => {
        const session = await signIn(4005);
        await dispatch('/v1/machines', { method: 'POST', headers: bearer(session), body: registration(session, newKeyPair(), 'studio') });
        const response = await dispatch('/v1/statements', {
            method: 'POST',
            headers: bearer(session),
            body: accessRequest('studio', newKeyPair(), newKeyPair())
        });
        expect(response.status).toBe(403);
        expect(await errorCode(response)).toBe('bad-signature');
    });

    test('an account that asks too often is told to wait', async () => {
        const session = await signIn(4006);
        await dispatch('/v1/machines', { method: 'POST', headers: bearer(session), body: registration(session, newKeyPair(), 'busy') });
        let limited: Response | null = null;
        // Twice the limit plus two, so one window holds more than the limit even when the minute turns halfway.
        for (let i = 0; i < 62 && !limited; i++) {
            const response = await dispatch('/v1/statements', { method: 'POST', headers: bearer(session), body: accessRequest('busy', newKeyPair()) });
            if (response.status === 429) {
                limited = response;
            } else {
                expect(response.status).toBe(200);
                await response.arrayBuffer();
            }
        }
        expect(limited).not.toBeNull();
        expect(await errorCode(limited as Response)).toBe('rate-limited');
        expect(limited?.headers.get('retry-after')).not.toBeNull();
    });
});

describe('cors', () => {
    test('a loopback page and a listed origin may read the answers, another page may not', async () => {
        const loopback = await dispatch('/v1/machines', { method: 'OPTIONS', headers: { origin: 'http://127.0.0.1:4210' } });
        expect(loopback.status).toBe(204);
        expect(loopback.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:4210');
        expect(loopback.headers.get('access-control-allow-headers')).toContain('authorization');

        const listed = await dispatch('/v1/machines', { headers: { origin: 'https://app.example.com' } });
        expect(listed.headers.get('access-control-allow-origin')).toBe('https://app.example.com');

        const other = await dispatch('/v1/machines', { method: 'OPTIONS', headers: { origin: 'https://evil.example.com' } });
        expect(other.headers.get('access-control-allow-origin')).toBeNull();
    });
});

describe('an address book nobody configured', () => {
    let bare: Miniflare;

    beforeAll(async () => {
        bare = new Miniflare({ modules: true, script, compatibilityDate: '2026-08-01', d1Databases: { DB: 'pulsar-bare' }, bindings: { PUBLIC_ORIGIN } });
        const db = await bare.getD1Database('DB');
        for (const statement of readFileSync(join(APP_ROOT, 'migrations/0001_address_book.sql'), 'utf8')
            .split('\n')
            .filter((line) => !line.trim().startsWith('--'))
            .join('\n')
            .split(';')
            .map((part) => part.trim())) {
            if (statement.length > 0) {
                await db.prepare(statement).run();
            }
        }
    }, 30_000);

    afterAll(async () => {
        await bare.dispose();
    });

    test('says login is not configured instead of sending anyone to GitHub', async () => {
        const query = new URLSearchParams({
            redirect_uri: REDIRECT_URI,
            state: base64url(randomBytes(16)),
            code_challenge: sha256('x'.repeat(43)),
            code_challenge_method: 'S256'
        });
        const response = (await bare.dispatchFetch(`${PUBLIC_ORIGIN}/auth/github/start?${query}`, { redirect: 'manual' })) as unknown as Response;
        expect(response.status).toBe(503);
        expect(((await response.json()) as AddressBookError).error).toEqual({
            code: 'not-configured',
            message: 'Signing in with github is not configured on this address book yet'
        });
        const health = (await bare.dispatchFetch(`${PUBLIC_ORIGIN}/health`)) as unknown as Response;
        expect(await health.json()).toEqual({ ok: true, statementKey: null, providers: { github: false } });
    });
});
