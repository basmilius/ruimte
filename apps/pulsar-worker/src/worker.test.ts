import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, sign, verify, type KeyObject } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    PULSAR_STATEMENT_PUBLIC_KEYS,
    APPLE_NATIVE_CLIENT_ID,
    APP_REDIRECT_SCHEME_URI,
    type NativeAppleStartResult,
    accessRequestMessage,
    accessStatementMessage,
    deviceLinkStartMessage,
    machineRegistrationMessage,
    sessionKeyMessage,
    sessionRefreshMessage,
    type AccessStatement,
    type AccountResult,
    type AddressBookError,
    type DeviceLinkCompleteResult,
    type DeviceLinkLookupResult,
    type DeviceLinkPollResult,
    type DeviceLinkStartResult,
    type IdentityLinkStartResult,
    type MachineListResult,
    type ProviderId,
    type SessionResult
} from '@ruimte/pulsar';
import { Miniflare } from 'miniflare';
import { LIMITS, WINDOW_MS, retryAfterSeconds, windowStartOf } from './rate-window.ts';

/*
 * The Worker bundled the way wrangler would, in workerd through Miniflare, against an in-memory D1
 * with the real migrations. GitHub and Apple are the outbound service: nothing leaves the process.
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

// Every migration by default; `files` picks some, so a test can seed the database the way an older Worker left it.
const migrate = async (mf: Miniflare, files?: (file: string) => boolean): Promise<void> => {
    const db = await mf.getD1Database('DB');
    const folder = join(APP_ROOT, 'migrations');
    for (const file of readdirSync(folder)
        .sort()
        .filter(files ?? (() => true))) {
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

const APPLE_TEAM_ID = 'TEAMID0001';
const APPLE_KEY_ID = 'APPLEKEY01';
const APPLE_CLIENT_ID = 'app.ruimte.test';
const APPLE_ISSUER = 'https://appleid.apple.com';
// The .p8 the Worker signs its client secret with, and the key Apple signs every id_token with.
const appleClientKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const appleSigningKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const APPLE_SIGNING_KID = 'apple-test-key';

interface AppleCode {
    sub: string;
    nonce: string;
    claims?: Record<string, unknown>;
    signer?: KeyObject;
    native?: boolean;
}
const appleCodes = new Map<string, AppleCode>();

const signRs256 = (payload: Record<string, unknown>, signer: KeyObject): string => {
    const input = `${base64url(Buffer.from(JSON.stringify({ alg: 'RS256', kid: APPLE_SIGNING_KID })))}.${base64url(Buffer.from(JSON.stringify(payload)))}`;
    return `${input}.${base64url(sign('sha256', Buffer.from(input), signer))}`;
};

// Checks the client secret against the Services ID or native App ID used for this code.
const appleClientSecretHolds = (secret: string, clientId: string): boolean => {
    const [header, payload, signature] = secret.split('.');
    if (!header || !payload || !signature) {
        return false;
    }
    const head = JSON.parse(Buffer.from(header, 'base64url').toString()) as Record<string, unknown>;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, number | string>;
    return (
        head.alg === 'ES256' &&
        head.kid === APPLE_KEY_ID &&
        claims.iss === APPLE_TEAM_ID &&
        claims.sub === clientId &&
        claims.aud === APPLE_ISSUER &&
        Number(claims.exp) > Number(claims.iat) &&
        verify('sha256', Buffer.from(`${header}.${payload}`), { key: appleClientKey.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))
    );
};

const apple = async (request: Request, url: URL): Promise<Response> => {
    if (url.href === `${APPLE_ISSUER}/auth/keys`) {
        return Response.json({ keys: [{ ...appleSigningKey.publicKey.export({ format: 'jwk' }), kid: APPLE_SIGNING_KID, alg: 'RS256', use: 'sig' }] });
    }
    if (url.href === `${APPLE_ISSUER}/auth/token`) {
        const form = new URLSearchParams(await request.text());
        const code = form.get('code') ?? '';
        const entry = appleCodes.get(code);
        appleCodes.delete(code);
        const clientId = entry?.native ? APPLE_NATIVE_CLIENT_ID : APPLE_CLIENT_ID;
        if (
            !entry ||
            form.get('client_id') !== clientId ||
            form.get('grant_type') !== 'authorization_code' ||
            form.get('redirect_uri') !== (entry.native ? null : `${PUBLIC_ORIGIN}/auth/apple/callback`) ||
            !appleClientSecretHolds(form.get('client_secret') ?? '', clientId)
        ) {
            return Response.json({ error: 'invalid_grant' }, { status: 400 });
        }
        const now = Math.floor(Date.now() / 1000);
        const claims = { iss: APPLE_ISSUER, aud: clientId, iat: now, exp: now + 600, sub: entry.sub, nonce: entry.nonce, ...entry.claims };
        return Response.json({
            access_token: 'apple-access',
            token_type: 'Bearer',
            expires_in: 3600,
            id_token: signRs256(claims, entry.signer ?? appleSigningKey.privateKey)
        });
    }
    return new Response(`unexpected outbound request to ${url.href}`, { status: 599 });
};

const outbound = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.origin === APPLE_ISSUER) {
        return apple(request, url);
    }
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

interface DispatchInit {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    // A form body instead of JSON, the way Apple posts its answer.
    form?: Record<string, string>;
    ip?: string;
    // Another Worker than the one every other test shares.
    on?: Miniflare;
}

const dispatch = async (path: string, init: DispatchInit = {}): Promise<Response> => {
    const headers: Record<string, string> = { 'cf-connecting-ip': init.ip ?? nextIp(), ...init.headers };
    let body: string | undefined;
    if (init.form !== undefined) {
        headers['content-type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(init.form).toString();
    } else if (init.body !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(init.body);
    }
    const response = await (init.on ?? mf).dispatchFetch(`${PUBLIC_ORIGIN}${path}`, { method: init.method ?? 'GET', headers, body, redirect: 'manual' });
    return response as unknown as Response;
};

const bearer = (session: SessionResult): Record<string, string> => ({ authorization: `Bearer ${session.accessToken}` });

interface LoginStart {
    verifier: string;
    appState: string;
    cookie: string;
    setCookie: string;
    providerState: string;
    // The PKCE challenge the address book sent GitHub, or the nonce it sent Apple.
    providerChallenge: string;
    ip: string;
    on?: Miniflare;
}

const AUTHORIZE_URLS: Record<ProviderId, string> = {
    github: 'https://github.com/login/oauth/authorize',
    apple: `${APPLE_ISSUER}/auth/authorize`
};

const startLogin = async (provider: ProviderId = 'github', options: { link?: string; on?: Miniflare } = {}): Promise<LoginStart> => {
    const verifier = base64url(randomBytes(32));
    const appState = base64url(randomBytes(16));
    const ip = nextIp();
    const query = new URLSearchParams({ redirect_uri: REDIRECT_URI, state: appState, code_challenge: sha256(verifier), code_challenge_method: 'S256' });
    if (options.link !== undefined) {
        query.set('link', options.link);
    }
    const response = await dispatch(`/auth/${provider}/start?${query}`, { ip, on: options.on });
    expect(response.status).toBe(302);
    const authorize = new URL(response.headers.get('location') ?? '');
    expect(authorize.origin + authorize.pathname).toBe(AUTHORIZE_URLS[provider]);
    const setCookie = response.headers.get('set-cookie') ?? '';
    return {
        verifier,
        appState,
        cookie: setCookie.split(';')[0] ?? '',
        setCookie,
        providerState: authorize.searchParams.get('state') ?? '',
        providerChallenge: authorize.searchParams.get(provider === 'apple' ? 'nonce' : 'code_challenge') ?? '',
        ip,
        on: options.on
    };
};

const githubCallback = async (start: LoginStart, userId: number, cookie = start.cookie): Promise<Response> => {
    const code = randomBytes(8).toString('hex');
    githubCodes.set(code, { userId, challenge: start.providerChallenge });
    return dispatch(`/auth/github/callback?${new URLSearchParams({ code, state: start.providerState })}`, { headers: { cookie }, ip: start.ip, on: start.on });
};

const appleCallback = async (start: LoginStart, sub: string, options: { cookie?: string; code?: Partial<AppleCode> } = {}): Promise<Response> => {
    const code = randomBytes(8).toString('hex');
    appleCodes.set(code, { sub, nonce: start.providerChallenge, ...options.code });
    return dispatch('/auth/apple/callback', {
        method: 'POST',
        form: { code, state: start.providerState },
        headers: { cookie: options.cookie ?? start.cookie, origin: APPLE_ISSUER },
        ip: start.ip,
        on: start.on
    });
};

const codeOf = (callback: Response): string => {
    expect(callback.status).toBe(302);
    return new URL(callback.headers.get('location') ?? '').searchParams.get('code') ?? '';
};

const callbackFor = (provider: ProviderId, start: LoginStart, subject: string): Promise<Response> =>
    provider === 'apple' ? appleCallback(start, subject) : githubCallback(start, Number(subject));

const bindKey = (code: string, key: KeyPair, signer = key) => ({
    sessionKey: key.publicKey,
    sessionKeySignature: signWith(signer, sessionKeyMessage(code, key.publicKey))
});

interface SignedIn extends SessionResult {
    key: KeyPair;
}

const signInWith = async (provider: ProviderId, subject: string, key = newKeyPair(), on?: Miniflare): Promise<SignedIn> => {
    const start = await startLogin(provider, { on });
    const callback = await callbackFor(provider, start, subject);
    expect(callback.status).toBe(302);
    const back = new URL(callback.headers.get('location') ?? '');
    expect(back.searchParams.get('state')).toBe(start.appState);
    const code = back.searchParams.get('code') ?? '';
    const response = await dispatch('/v1/session', {
        method: 'POST',
        body: { code, codeVerifier: start.verifier, redirectUri: REDIRECT_URI, label: 'Test device', ...bindKey(code, key) },
        ip: start.ip,
        on
    });
    expect(response.status).toBe(200);
    return { ...((await response.json()) as SessionResult), key };
};

const signIn = (userId: number, key = newKeyPair(), on?: Miniflare): Promise<SignedIn> => signInWith('github', String(userId), key, on);

const signInWithApple = (sub: string): Promise<SignedIn> => signInWith('apple', sub);

const requestLink = async (session: SessionResult, provider: ProviderId): Promise<string> => {
    const response = await dispatch('/v1/account/link', { method: 'POST', body: { provider }, headers: bearer(session) });
    expect(response.status).toBe(200);
    return ((await response.json()) as IdentityLinkStartResult).linkToken;
};

interface LinkLogin {
    start: LoginStart;
    code: string;
}

const linkLogin = async (session: SessionResult, provider: ProviderId, subject: string): Promise<LinkLogin> => {
    const start = await startLogin(provider, { link: await requestLink(session, provider) });
    return { start, code: codeOf(await callbackFor(provider, start, subject)) };
};

const completeLink = (session: SessionResult, login: LinkLogin, verifier = login.start.verifier): Promise<Response> =>
    dispatch('/v1/account/identities', {
        method: 'POST',
        body: { code: login.code, codeVerifier: verifier, redirectUri: REDIRECT_URI },
        headers: bearer(session)
    });

const accountOf = async (session: SessionResult): Promise<AccountResult> => {
    const response = await dispatch('/v1/account', { headers: bearer(session) });
    expect(response.status).toBe(200);
    return (await response.json()) as AccountResult;
};

const refreshBody = (refreshToken: string, key: KeyPair, issuedAt = Date.now()) => ({
    refreshToken,
    issuedAt,
    signature: signWith(key, sessionRefreshMessage(refreshToken, issuedAt))
});

const registration = (session: SessionResult, machine: KeyPair, id: string, accountId = session.account.id, signer = machine) => {
    const issuedAt = Date.now();
    const name = `Machine ${id}`;
    return {
        id,
        name,
        icon: { kind: 'lucide', value: 'server' },
        brokerUrl: 'wss://broker.ruimte.test',
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

/*
 * A bucket already at its limit, so the next request through the route is the refusal. Filling it with
 * real requests costs a round trip each, and a slow runner spent seconds on it. The Worker reads its own
 * clock, so the next window is filled too, in case the minute turns between this and the request.
 */
const spendLimit = async (bucket: string, limit: number): Promise<void> => {
    const db = await mf.getD1Database('DB');
    const now = Date.now();
    for (const windowStart of [now - (now % WINDOW_MS), now - (now % WINDOW_MS) + WINDOW_MS]) {
        await db
            .prepare('INSERT INTO rate_limit (bucket, window_start, count) VALUES (?1, ?2, ?3) ON CONFLICT (bucket, window_start) DO UPDATE SET count = ?3')
            .bind(bucket, windowStart, limit)
            .run();
    }
};

const APPLE_BINDINGS = {
    APPLE_TEAM_ID,
    APPLE_KEY_ID,
    APPLE_PRIVATE_KEY: appleClientKey.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    APPLE_CLIENT_ID
};

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
            ...APPLE_BINDINGS,
            STATEMENT_PRIVATE_KEY: statementSecret
        },
        outboundService: outbound
    });
    await migrate(mf);
}, 30_000);

afterAll(async () => {
    await mf.dispose();
});

describe('rate limit windows', () => {
    const windowStart = 1_700_000_040_000;

    test('every moment of a minute counts in the window that minute starts', () => {
        expect(windowStartOf(windowStart)).toBe(windowStart);
        expect(windowStartOf(windowStart + WINDOW_MS - 1)).toBe(windowStart);
        expect(windowStartOf(windowStart + WINDOW_MS)).toBe(windowStart + WINDOW_MS);
    });

    test('a refusal names the seconds left in its window, rounded up', () => {
        expect(retryAfterSeconds(windowStart + 15_000)).toBe(45);
        expect(retryAfterSeconds(windowStart + 59_001)).toBe(1);
        expect(retryAfterSeconds(windowStart)).toBe(60);
    });
});

describe('health', () => {
    test('names the statement key and the providers that are configured', async () => {
        const response = await dispatch('/health');
        expect(await response.json()).toEqual({ ok: true, statementKey: statementPublicKey, providers: { github: true, apple: true } });
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

    test('refuses to send the browser anywhere but the app, the web client or the dev origin', async () => {
        const startWith = (redirectUri: string) =>
            dispatch(
                `/auth/github/start?${new URLSearchParams({ redirect_uri: redirectUri, state: base64url(randomBytes(16)), code_challenge: sha256('x'.repeat(43)), code_challenge_method: 'S256' })}`
            );
        for (const refused of [
            'https://evil.example.com/pulsar/callback',
            'https://station.ruimte.app/elsewhere',
            'https://station.ruimte.app.evil.example.com/pulsar/callback',
            'http://station.ruimte.app/pulsar/callback',
            'https://station.ruimte.app/pulsar/callback?next=https://evil.example.com',
            'http://localhost:5174/pulsar/callback'
        ]) {
            const response = await startWith(refused);
            expect(response.status).toBe(400);
            expect(await errorCode(response)).toBe('bad-request');
        }
        for (const allowed of [
            'https://station.ruimte.app/pulsar/callback',
            'http://localhost:5173/pulsar/callback',
            'ruimte://pulsar/callback',
            REDIRECT_URI
        ]) {
            expect((await startWith(allowed)).status).toBe(302);
        }
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
        const code = back.searchParams.get('code') ?? '';
        const key = newKeyPair();
        const wrong = await dispatch('/v1/session', {
            method: 'POST',
            body: { code, codeVerifier: base64url(randomBytes(32)), redirectUri: REDIRECT_URI, ...bindKey(code, key) },
            ip: start.ip
        });
        expect(wrong.status).toBe(401);
        const right = await dispatch('/v1/session', {
            method: 'POST',
            body: { code, codeVerifier: start.verifier, redirectUri: REDIRECT_URI, ...bindKey(code, key) },
            ip: start.ip
        });
        expect(right.status).toBe(401);
    });

    test('the code is refused for another redirect than the one the login started with', async () => {
        const start = await startLogin();
        const back = new URL((await githubCallback(start, 1006)).headers.get('location') ?? '');
        const code = back.searchParams.get('code') ?? '';
        const response = await dispatch('/v1/session', {
            method: 'POST',
            body: { code, codeVerifier: start.verifier, redirectUri: 'http://127.0.0.1:9999/pulsar/callback', ...bindKey(code, newKeyPair()) },
            ip: start.ip
        });
        expect(response.status).toBe(401);
    });

    test('a session is only opened for a key that signed the login code', async () => {
        const start = await startLogin();
        const back = new URL((await githubCallback(start, 1007)).headers.get('location') ?? '');
        const code = back.searchParams.get('code') ?? '';
        const unbound = await dispatch('/v1/session', {
            method: 'POST',
            body: { code, codeVerifier: start.verifier, redirectUri: REDIRECT_URI },
            ip: start.ip
        });
        expect(unbound.status).toBe(400);

        const forged = await dispatch('/v1/session', {
            method: 'POST',
            body: { code, codeVerifier: start.verifier, redirectUri: REDIRECT_URI, ...bindKey(code, newKeyPair(), newKeyPair()) },
            ip: start.ip
        });
        expect(forged.status).toBe(403);
        expect(await errorCode(forged)).toBe('bad-signature');
    });
});

describe('sessions', () => {
    test('a refresh rotates both tokens, and a spent refresh token ends the session', async () => {
        const session = await signIn(2001);
        const refreshed = await dispatch('/v1/session/refresh', { method: 'POST', body: refreshBody(session.refreshToken, session.key) });
        expect(refreshed.status).toBe(200);
        const next = (await refreshed.json()) as SessionResult;
        expect(next.refreshToken).not.toBe(session.refreshToken);
        expect((await dispatch('/v1/machines', { headers: bearer(session) })).status).toBe(401);
        expect((await dispatch('/v1/machines', { headers: bearer(next) })).status).toBe(200);

        const replay = await dispatch('/v1/session/refresh', { method: 'POST', body: refreshBody(session.refreshToken, session.key) });
        expect(replay.status).toBe(401);
        expect((await dispatch('/v1/machines', { headers: bearer(next) })).status).toBe(401);
        expect((await dispatch('/v1/session/refresh', { method: 'POST', body: refreshBody(next.refreshToken, session.key) })).status).toBe(401);
    });

    test('a refresh without a signature is refused', async () => {
        const session = await signIn(2003);
        const response = await dispatch('/v1/session/refresh', { method: 'POST', body: { refreshToken: session.refreshToken } });
        expect(response.status).toBe(400);
        expect((await dispatch('/v1/session/refresh', { method: 'POST', body: refreshBody(session.refreshToken, session.key) })).status).toBe(200);
    });

    test('a refresh token without its key is worth nothing, and cannot end the session it was copied from', async () => {
        const session = await signIn(2004);
        const stolen = await dispatch('/v1/session/refresh', { method: 'POST', body: refreshBody(session.refreshToken, newKeyPair()) });
        expect(stolen.status).toBe(401);
        expect((await dispatch('/v1/machines', { headers: bearer(session) })).status).toBe(200);

        const refreshed = await dispatch('/v1/session/refresh', { method: 'POST', body: refreshBody(session.refreshToken, session.key) });
        expect(refreshed.status).toBe(200);
        const next = (await refreshed.json()) as SessionResult;
        // A spent token without the key is not a second holder either, so the session carries on.
        expect((await dispatch('/v1/session/refresh', { method: 'POST', body: refreshBody(session.refreshToken, newKeyPair()) })).status).toBe(401);
        expect((await dispatch('/v1/machines', { headers: bearer(next) })).status).toBe(200);
    });

    test('a signature from long ago is refused, and a signature for one token does not refresh another', async () => {
        const session = await signIn(2005);
        const old = await dispatch('/v1/session/refresh', { method: 'POST', body: refreshBody(session.refreshToken, session.key, Date.now() - 11 * 60_000) });
        expect(old.status).toBe(401);
        const other = await signIn(2005, session.key);
        const moved = { ...refreshBody(other.refreshToken, session.key), refreshToken: session.refreshToken };
        expect((await dispatch('/v1/session/refresh', { method: 'POST', body: moved })).status).toBe(401);
        expect((await dispatch('/v1/session/refresh', { method: 'POST', body: refreshBody(session.refreshToken, session.key) })).status).toBe(200);
    });

    test('a replayed refresh with the right key ends the session', async () => {
        const session = await signIn(2006);
        const body = refreshBody(session.refreshToken, session.key);
        const first = await dispatch('/v1/session/refresh', { method: 'POST', body });
        expect(first.status).toBe(200);
        const next = (await first.json()) as SessionResult;
        expect((await dispatch('/v1/session/refresh', { method: 'POST', body })).status).toBe(401);
        expect((await dispatch('/v1/machines', { headers: bearer(next) })).status).toBe(401);
    });

    test('a session from before the binding has to sign in again', async () => {
        const session = await signIn(2007);
        const db = await mf.getD1Database('DB');
        await db.prepare('UPDATE session SET session_key = NULL WHERE refresh_hash = ?1').bind(sha256(session.refreshToken)).run();
        expect((await dispatch('/v1/session/refresh', { method: 'POST', body: refreshBody(session.refreshToken, session.key) })).status).toBe(401);
    });

    test('signing out revokes the session', async () => {
        const session = await signIn(2002);
        expect((await dispatch('/v1/session', { method: 'DELETE', headers: bearer(session) })).status).toBe(204);
        expect((await dispatch('/v1/machines', { headers: bearer(session) })).status).toBe(401);
        expect((await dispatch('/v1/session/refresh', { method: 'POST', body: refreshBody(session.refreshToken, session.key) })).status).toBe(401);
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
            brokerUrl: 'wss://broker.ruimte.test',
            publicKey: machine.publicKey
        });

        expect((await dispatch('/v1/machines/studio', { method: 'DELETE', headers: bearer(session) })).status).toBe(204);
        expect((await dispatch('/v1/machines/studio', { method: 'DELETE', headers: bearer(session) })).status).toBe(404);
        const empty = (await (await dispatch('/v1/machines', { headers: bearer(session) })).json()) as MachineListResult;
        expect(empty.machines).toHaveLength(0);
        expect(empty.removedMachineIds).toEqual(['studio']);
    });

    test('a machine a person removed is not put back by a client on its own, only by adding it again', async () => {
        const session = await signIn(3005);
        const machine = newKeyPair();
        const automatic = () => ({ ...registration(session, machine, 'desk'), automatic: true });
        expect((await dispatch('/v1/machines', { method: 'POST', headers: bearer(session), body: automatic() })).status).toBe(200);
        // Registering again is harmless: the same row, with a new `lastSeenAt`.
        expect((await dispatch('/v1/machines', { method: 'POST', headers: bearer(session), body: automatic() })).status).toBe(200);
        expect((await dispatch('/v1/machines/desk', { method: 'DELETE', headers: bearer(session) })).status).toBe(204);

        const refused = await dispatch('/v1/machines', { method: 'POST', headers: bearer(session), body: automatic() });
        expect(refused.status).toBe(409);
        expect(await errorCode(refused)).toBe('removed');
        expect(((await (await dispatch('/v1/machines', { headers: bearer(session) })).json()) as MachineListResult).machines).toHaveLength(0);

        // Removed on one account says nothing about another account the same machine is on.
        const other = await signIn(3006);
        expect(
            (await dispatch('/v1/machines', { method: 'POST', headers: bearer(other), body: { ...registration(other, machine, 'desk'), automatic: true } }))
                .status
        ).toBe(200);

        expect((await dispatch('/v1/machines', { method: 'POST', headers: bearer(session), body: registration(session, machine, 'desk') })).status).toBe(200);
        const back = (await (await dispatch('/v1/machines', { headers: bearer(session) })).json()) as MachineListResult;
        expect(back.machines.map((entry) => entry.id)).toEqual(['desk']);
        expect(back.removedMachineIds).toEqual([]);
        expect((await dispatch('/v1/machines', { method: 'POST', headers: bearer(session), body: automatic() })).status).toBe(200);
    });

    test('a registration without a broker lists the machine without one, and registering again replaces it', async () => {
        const session = await signIn(3004);
        const machine = newKeyPair();
        const { brokerUrl: _dropped, ...withoutBroker } = registration(session, machine, 'quiet');
        expect((await dispatch('/v1/machines', { method: 'POST', headers: bearer(session), body: withoutBroker })).status).toBe(200);
        let list = (await (await dispatch('/v1/machines', { headers: bearer(session) })).json()) as MachineListResult;
        expect(list.machines[0]?.brokerUrl).toBeNull();

        const withBroker = { ...registration(session, machine, 'quiet'), brokerUrl: 'ws://127.0.0.1:4420' };
        expect((await dispatch('/v1/machines', { method: 'POST', headers: bearer(session), body: withBroker })).status).toBe(200);
        list = (await (await dispatch('/v1/machines', { headers: bearer(session) })).json()) as MachineListResult;
        expect(list.machines.map((entry) => entry.brokerUrl)).toEqual(['ws://127.0.0.1:4420']);
    });

    test('registering again with the same key updates the record, and another key for that machine is refused', async () => {
        const session = await signIn(3007);
        const machine = newKeyPair();
        expect((await dispatch('/v1/machines', { method: 'POST', headers: bearer(session), body: registration(session, machine, 'laptop') })).status).toBe(200);

        const issuedAt = Date.now();
        const renamed = {
            id: 'laptop',
            name: 'Laptop',
            icon: { kind: 'lucide', value: 'laptop' },
            brokerUrl: 'wss://other-broker.ruimte.test',
            publicKey: machine.publicKey,
            issuedAt,
            signature: signWith(machine, machineRegistrationMessage(session.account.id, 'laptop', machine.publicKey, 'Laptop', issuedAt)),
            automatic: true
        };
        expect((await dispatch('/v1/machines', { method: 'POST', headers: bearer(session), body: renamed })).status).toBe(200);
        let list = (await (await dispatch('/v1/machines', { headers: bearer(session) })).json()) as MachineListResult;
        expect(list.machines).toEqual([
            expect.objectContaining({ id: 'laptop', name: 'Laptop', icon: { kind: 'lucide', value: 'laptop' }, brokerUrl: 'wss://other-broker.ruimte.test' })
        ]);

        const intruder = newKeyPair();
        for (const automatic of [true, false]) {
            const taken = await dispatch('/v1/machines', {
                method: 'POST',
                headers: bearer(session),
                body: { ...registration(session, intruder, 'laptop'), automatic }
            });
            expect(taken.status).toBe(403);
            expect(await errorCode(taken)).toBe('bad-signature');
        }
        list = (await (await dispatch('/v1/machines', { headers: bearer(session) })).json()) as MachineListResult;
        expect(list.machines).toEqual([expect.objectContaining({ name: 'Laptop', publicKey: machine.publicKey })]);
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
        await spendLimit(`account:${session.account.id}:statement`, LIMITS.statementAccount);
        const limited = await dispatch('/v1/statements', { method: 'POST', headers: bearer(session), body: accessRequest('busy', newKeyPair()) });
        expect(limited.status).toBe(429);
        expect(limited.headers.get('retry-after')).not.toBeNull();
        expect(await errorCode(limited)).toBe('rate-limited');
    });
});

describe('linking a machine with a code', () => {
    const linkStart = (machine: KeyPair, id: string, signer = machine, issuedAt = Date.now()) => {
        const name = `Linked ${id}`;
        return {
            id,
            name,
            icon: { kind: 'lucide', value: 'server' },
            brokerUrl: 'wss://broker.ruimte.test',
            publicKey: machine.publicKey,
            issuedAt,
            signature: signWith(signer, deviceLinkStartMessage(id, machine.publicKey, name, issuedAt))
        };
    };

    const start = async (machine: KeyPair, id: string): Promise<DeviceLinkStartResult> => {
        const response = await dispatch('/v1/device/start', { method: 'POST', body: linkStart(machine, id) });
        expect(response.status).toBe(200);
        return (await response.json()) as DeviceLinkStartResult;
    };

    const poll = async (deviceCode: string): Promise<Response> => dispatch('/v1/device/poll', { method: 'POST', body: { deviceCode } });

    const pollStatus = async (deviceCode: string): Promise<DeviceLinkPollResult> => {
        const response = await poll(deviceCode);
        expect(response.status).toBe(200);
        return (await response.json()) as DeviceLinkPollResult;
    };

    const byCode = (route: 'lookup' | 'approve' | 'deny', session: SessionResult | null, userCode: string): Promise<Response> =>
        dispatch(`/v1/device/${route}`, { method: 'POST', headers: session ? bearer(session) : {}, body: { userCode } });

    const completion = (link: DeviceLinkStartResult, machine: KeyPair, id: string, accountId: string, issuedAt = Date.now()) => ({
        deviceCode: link.deviceCode,
        issuedAt,
        signature: signWith(machine, machineRegistrationMessage(accountId, id, machine.publicKey, `Linked ${id}`, issuedAt))
    });

    test('a start with a signature from another key is refused', async () => {
        const response = await dispatch('/v1/device/start', { method: 'POST', body: linkStart(newKeyPair(), 'forged', newKeyPair()) });
        expect(response.status).toBe(403);
        expect(await errorCode(response)).toBe('bad-signature');
    });

    test('a start signed long ago is refused', async () => {
        const response = await dispatch('/v1/device/start', { method: 'POST', body: linkStart(newKeyPair(), 'stale', undefined, Date.now() - 11 * 60_000) });
        expect(response.status).toBe(400);
    });

    test('a start answers a code of two groups of four letters, the page and the interval', async () => {
        const link = await start(newKeyPair(), 'format');
        expect(link.userCode).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
        expect(link.verificationUri).toBe('https://station.ruimte.app/link');
        expect(new URL(link.verificationUriComplete).searchParams.get('code')).toBe(link.userCode);
        expect(link.interval).toBe(5);
        expect(link.expiresAt - Date.now()).toBeGreaterThan(9 * 60_000);
    });

    test('a person approves, the machine signs for that account, and it is listed once', async () => {
        const machine = newKeyPair();
        const link = await start(machine, 'linked');
        expect(await pollStatus(link.deviceCode)).toEqual({ status: 'pending', interval: 5, account: null });

        const session = await signIn(5001);
        const lookup = await byCode('lookup', session, link.userCode.toLowerCase());
        expect(lookup.status).toBe(200);
        expect(((await lookup.json()) as DeviceLinkLookupResult).machine).toEqual({
            id: 'linked',
            name: 'Linked linked',
            icon: { kind: 'lucide', value: 'server' },
            publicKey: machine.publicKey
        });
        expect((await byCode('approve', session, link.userCode)).status).toBe(200);

        const approved = await pollStatus(link.deviceCode);
        expect(approved.status).toBe('approved');
        expect(approved.account?.id).toBe(session.account.id);

        const forOther = await dispatch('/v1/device/complete', { method: 'POST', body: completion(link, machine, 'linked', 'another-account') });
        expect(forOther.status).toBe(403);
        expect(await errorCode(forOther)).toBe('bad-signature');

        const complete = await dispatch('/v1/device/complete', { method: 'POST', body: completion(link, machine, 'linked', session.account.id) });
        expect(complete.status).toBe(200);
        const result = (await complete.json()) as DeviceLinkCompleteResult;
        expect(result.account.login).toBe('user-5001');
        expect(result.machine.brokerUrl).toBe('wss://broker.ruimte.test');

        const list = (await (await dispatch('/v1/machines', { headers: bearer(session) })).json()) as MachineListResult;
        expect(list.machines.map((entry) => entry.id)).toEqual(['linked']);

        // The device code is spent, and so is the user code.
        const again = await dispatch('/v1/device/complete', { method: 'POST', body: completion(link, machine, 'linked', session.account.id) });
        expect(again.status).toBe(404);
        expect((await poll(link.deviceCode)).status).toBe(404);
        expect((await byCode('approve', session, link.userCode)).status).toBe(404);
    });

    test('a code is approved once, and a second account gets nothing for it', async () => {
        const link = await start(newKeyPair(), 'contested');
        expect((await byCode('approve', await signIn(5002), link.userCode)).status).toBe(200);
        const late = await byCode('approve', await signIn(5003), link.userCode);
        expect(late.status).toBe(404);
        expect(await errorCode(late)).toBe('not-found');
    });

    test('nothing happens to a code without a session', async () => {
        const link = await start(newKeyPair(), 'no-session');
        for (const route of ['lookup', 'approve', 'deny'] as const) {
            const response = await byCode(route, null, link.userCode);
            expect(response.status).toBe(401);
        }
        expect((await pollStatus(link.deviceCode)).status).toBe('pending');
    });

    test('a complete before anyone approved is refused', async () => {
        const machine = newKeyPair();
        const link = await start(machine, 'early');
        const response = await dispatch('/v1/device/complete', { method: 'POST', body: completion(link, machine, 'early', 'anyone') });
        expect(response.status).toBe(404);
    });

    test('a denial and a cancel are told to the terminal', async () => {
        const denied = await start(newKeyPair(), 'denied');
        expect((await byCode('deny', await signIn(5004), denied.userCode)).status).toBe(204);
        expect((await pollStatus(denied.deviceCode)).status).toBe('denied');

        const cancelled = await start(newKeyPair(), 'cancelled');
        expect((await dispatch('/v1/device/cancel', { method: 'POST', body: { deviceCode: cancelled.deviceCode } })).status).toBe(204);
        expect((await pollStatus(cancelled.deviceCode)).status).toBe('cancelled');
        expect((await byCode('lookup', await signIn(5005), cancelled.userCode)).status).toBe(404);
    });

    test('an expired code is refused on the page and said so to the terminal', async () => {
        const link = await start(newKeyPair(), 'expired');
        const db = await mf.getD1Database('DB');
        await db
            .prepare('UPDATE device_link SET expires_at = ?1 WHERE user_code = ?2')
            .bind(Date.now() - 1, link.userCode.replace('-', ''))
            .run();
        expect((await pollStatus(link.deviceCode)).status).toBe('expired');
        expect((await byCode('lookup', await signIn(5006), link.userCode)).status).toBe(404);
        expect((await poll(base64url(randomBytes(32)))).status).toBe(404);
    });

    test('linking a machine a person removed puts it back', async () => {
        const machine = newKeyPair();
        const session = await signIn(5007);
        await dispatch('/v1/machines', { method: 'POST', headers: bearer(session), body: { ...registration(session, machine, 'returns') } });
        expect((await dispatch('/v1/machines/returns', { method: 'DELETE', headers: bearer(session) })).status).toBe(204);

        const issuedAt = Date.now();
        const body = { ...linkStart(machine, 'returns', machine, issuedAt), name: 'Machine returns' };
        body.signature = signWith(machine, deviceLinkStartMessage('returns', machine.publicKey, 'Machine returns', issuedAt));
        const link = (await (await dispatch('/v1/device/start', { method: 'POST', body })).json()) as DeviceLinkStartResult;
        expect((await byCode('approve', session, link.userCode)).status).toBe(200);
        const complete = await dispatch('/v1/device/complete', {
            method: 'POST',
            body: {
                deviceCode: link.deviceCode,
                issuedAt,
                signature: signWith(machine, machineRegistrationMessage(session.account.id, 'returns', machine.publicKey, 'Machine returns', issuedAt))
            }
        });
        expect(complete.status).toBe(200);
        const list = (await (await dispatch('/v1/machines', { headers: bearer(session) })).json()) as MachineListResult;
        expect(list.machines.map((entry) => entry.id)).toEqual(['returns']);
        expect(list.removedMachineIds).toEqual([]);
    });

    test('an address that starts too many links is told to wait', async () => {
        const ip = nextIp();
        await spendLimit(`ip:${ip}:device-start`, LIMITS.deviceStartIp);
        const limited = await dispatch('/v1/device/start', { method: 'POST', body: linkStart(newKeyPair(), 'burst'), ip });
        expect(limited.status).toBe(429);
        expect(await errorCode(limited)).toBe('rate-limited');
    });

    test('an account that guesses codes is told to wait', async () => {
        const session = await signIn(5008);
        await spendLimit(`account:${session.account.id}:device-code`, LIMITS.deviceCodeAccount);
        const limited = await byCode('lookup', session, 'BCDF-GHJK');
        expect(limited.status).toBe(429);
        expect(await errorCode(limited)).toBe('rate-limited');
    });

    test('an address that polls too often is told to wait', async () => {
        const link = await start(newKeyPair(), 'eager');
        const ip = nextIp();
        await spendLimit(`ip:${ip}:device-poll`, LIMITS.devicePollIp);
        const limited = await dispatch('/v1/device/poll', { method: 'POST', body: { deviceCode: link.deviceCode }, ip });
        expect(limited.status).toBe(429);
        expect(await errorCode(limited)).toBe('rate-limited');
    });
});

describe('native sign in with Apple', () => {
    const start = async (): Promise<NativeAppleStartResult & { verifier: string }> => {
        const verifier = base64url(randomBytes(32));
        const response = await dispatch('/v1/apple/start', { method: 'POST', body: { codeChallenge: sha256(verifier) } });
        expect(response.status).toBe(200);
        expect(response.headers.get('set-cookie')).toBeNull();
        const result = (await response.json()) as NativeAppleStartResult;
        return { ...result, verifier };
    };
    const credentials = (attempt: NativeAppleStartResult, sub: string, changes: Partial<AppleCode> = {}) => {
        const authorizationCode = base64url(randomBytes(32));
        appleCodes.set(authorizationCode, { native: true, sub, nonce: attempt.nonce, ...changes });
        const identityToken = signRs256(
            { iss: APPLE_ISSUER, aud: APPLE_NATIVE_CLIENT_ID, sub, nonce: attempt.nonce, exp: Math.floor(Date.now() / 1000) + 600 },
            appleSigningKey.privateKey
        );
        return { attempt: attempt.attempt, identityToken, authorizationCode };
    };
    const complete = (body: ReturnType<typeof credentials>) => dispatch('/v1/apple/complete', { method: 'POST', body });
    const exchange = (code: string, verifier: string, key = newKeyPair(), signer = key, redirectUri = APP_REDIRECT_SCHEME_URI) =>
        dispatch('/v1/session', {
            method: 'POST',
            body: { code, codeVerifier: verifier, redirectUri, ...bindKey(code, key, signer) }
        });

    test('native and web Apple logins resolve the same identity and exchange a code bound to PKCE and a signed key', async () => {
        const existing = await signInWithApple('native-shared-subject');
        const attempt = await start();
        expect(attempt.attempt).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(attempt.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(attempt.expiresAt).toBeGreaterThan(Date.now());
        const db = await mf.getD1Database('DB');
        expect(await db.prepare('SELECT attempt_hash FROM native_apple_login WHERE attempt_hash = ?1').bind(sha256(attempt.attempt)).first()).not.toBeNull();
        const response = await complete(credentials(attempt, 'native-shared-subject'));
        expect(response.status).toBe(200);
        expect(response.headers.get('location')).toBeNull();
        const { code } = (await response.json()) as { code: string };
        const key = newKeyPair();
        const session = await exchange(code, attempt.verifier, key);
        expect(session.status).toBe(200);
        const result = (await session.json()) as SessionResult;
        expect(result.account).toEqual(existing.account);
        expect((await exchange(code, attempt.verifier, key)).status).toBe(401);
        expect((await dispatch('/v1/session/refresh', { method: 'POST', body: refreshBody(result.refreshToken, key) })).status).toBe(200);
    });

    test('only one concurrent completion spends an attempt', async () => {
        const attempt = await start();
        const body = credentials(attempt, 'native-concurrent');
        const responses = await Promise.all([complete(body), complete(body)]);
        expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
        expect((await complete(body)).status).toBe(401);
    });

    test('expired attempts are spent before Apple is called', async () => {
        const attempt = await start();
        const body = credentials(attempt, 'native-expired');
        const db = await mf.getD1Database('DB');
        await db.prepare('UPDATE native_apple_login SET expires_at = 0 WHERE attempt_hash = ?1').bind(sha256(attempt.attempt)).run();
        expect((await complete(body)).status).toBe(401);
        expect(appleCodes.has(body.authorizationCode)).toBe(true);
        expect(await db.prepare('SELECT * FROM native_apple_login WHERE attempt_hash = ?1').bind(sha256(attempt.attempt)).first()).toBeNull();
    });

    test('a token from another attempt cannot be moved to a fresh nonce', async () => {
        const first = await start();
        const second = await start();
        const body = credentials(first, 'native-swapped-attempt');
        expect((await complete({ ...body, attempt: second.attempt })).status).toBe(401);
        expect(appleCodes.has(body.authorizationCode)).toBe(true);
        expect((await complete(body)).status).toBe(200);
        expect((await complete(credentials(second, 'native-swapped-attempt'))).status).toBe(401);
    });

    test('forged, expired, wrong issuer, audience and nonce client tokens spend their attempts without exchanging the Apple code', async () => {
        const otherSigner = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
        const cases = [
            { claims: { aud: APPLE_CLIENT_ID } },
            { claims: { aud: [APPLE_NATIVE_CLIENT_ID, APPLE_CLIENT_ID] } },
            { claims: { nonce: 'other' } },
            { claims: { iss: 'https://not-apple.test' } },
            { claims: { exp: 1 } },
            { claims: {}, signer: otherSigner }
        ];
        for (const invalid of cases) {
            const attempt = await start();
            const body = credentials(attempt, 'native-invalid-client');
            const valid = body.identityToken;
            body.identityToken = signRs256(
                {
                    iss: APPLE_ISSUER,
                    aud: APPLE_NATIVE_CLIENT_ID,
                    sub: 'native-invalid-client',
                    nonce: attempt.nonce,
                    exp: Math.floor(Date.now() / 1000) + 600,
                    ...invalid.claims
                },
                invalid.signer ?? appleSigningKey.privateKey
            );
            expect((await complete(body)).status).toBe(401);
            expect(appleCodes.has(body.authorizationCode)).toBe(true);
            expect((await complete({ ...body, identityToken: valid })).status).toBe(401);
        }
    });

    test('Apple must confirm the client subject and nonce with a valid native token', async () => {
        const otherSigner = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
        const changes: Partial<AppleCode>[] = [
            { sub: 'another-subject' },
            { nonce: 'another-nonce' },
            { claims: { aud: APPLE_CLIENT_ID } },
            { claims: { exp: 1 } },
            { signer: otherSigner }
        ];
        for (const change of changes) {
            const attempt = await start();
            const body = credentials(attempt, 'native-invalid-exchange', change);
            expect((await complete(body)).status).toBe(401);
            expect(appleCodes.has(body.authorizationCode)).toBe(false);
            expect((await complete(body)).status).toBe(401);
        }
        const db = await mf.getD1Database('DB');
        expect(await db.prepare("SELECT * FROM identity WHERE provider = 'apple' AND subject = 'native-invalid-exchange'").first()).toBeNull();
    });

    test('native login codes refuse a wrong verifier, redirect or key signature, and expire after a minute', async () => {
        for (const mode of ['verifier', 'redirect', 'signature', 'expired']) {
            const attempt = await start();
            const response = await complete(credentials(attempt, 'native-code-guards'));
            expect(response.status).toBe(200);
            const { code } = (await response.json()) as { code: string };
            const db = await mf.getD1Database('DB');
            const row = await db.prepare('SELECT expires_at FROM login_code WHERE code_hash = ?1').bind(sha256(code)).first<{ expires_at: number }>();
            expect(row!.expires_at).toBeLessThanOrEqual(Date.now() + 60_000);
            if (mode === 'expired') {
                await db.prepare('UPDATE login_code SET expires_at = 0 WHERE code_hash = ?1').bind(sha256(code)).run();
            }
            const key = newKeyPair();
            const result = await exchange(
                code,
                mode === 'verifier' ? 'x'.repeat(43) : attempt.verifier,
                key,
                mode === 'signature' ? newKeyPair() : key,
                mode === 'redirect' ? REDIRECT_URI : APP_REDIRECT_SCHEME_URI
            );
            expect(result.status).toBe(mode === 'signature' ? 403 : 401);
            expect((await exchange(code, attempt.verifier, key)).status).toBe(401);
        }
    });

    test('native start applies the existing login IP budget and rejects invalid PKCE challenges', async () => {
        expect((await dispatch('/v1/apple/start', { method: 'POST', body: { codeChallenge: 'short' } })).status).toBe(400);
        const ip = nextIp();
        const db = await mf.getD1Database('DB');
        await db
            .prepare('INSERT INTO rate_limit (bucket, window_start, count) VALUES (?1, ?2, ?3)')
            .bind(`ip:${ip}:login`, windowStartOf(Date.now()), LIMITS.loginIp)
            .run();
        expect((await dispatch('/v1/apple/start', { method: 'POST', ip, body: { codeChallenge: sha256('x'.repeat(43)) } })).status).toBe(429);
    });
});

describe('sign in with Apple', () => {
    test('a whole login ends in a session for the Apple subject, and the next one opens the same account', async () => {
        const session = await signInWithApple('apple-1001');
        expect(session.account.provider).toBe('apple');
        expect(session.account.login).toBeNull();
        const again = await signInWithApple('apple-1001');
        expect(again.account.id).toBe(session.account.id);
    });

    test('the start asks for a form post with a nonce and no scope, with a cookie that survives a cross-site post', async () => {
        const start = await startLogin('apple');
        const response = await dispatch(
            `/auth/apple/start?${new URLSearchParams({ redirect_uri: REDIRECT_URI, state: base64url(randomBytes(16)), code_challenge: sha256('y'.repeat(43)), code_challenge_method: 'S256' })}`
        );
        const authorize = new URL(response.headers.get('location') ?? '');
        expect(authorize.searchParams.get('response_mode')).toBe('form_post');
        expect(authorize.searchParams.get('response_type')).toBe('code');
        expect(authorize.searchParams.get('client_id')).toBe(APPLE_CLIENT_ID);
        expect(authorize.searchParams.get('redirect_uri')).toBe(`${PUBLIC_ORIGIN}/auth/apple/callback`);
        expect(authorize.searchParams.has('scope')).toBe(false);
        expect(start.providerChallenge.length).toBe(43);
        expect(start.setCookie).toContain('SameSite=None');
        expect(start.setCookie).toContain('Secure');
        expect(start.setCookie).toContain('HttpOnly');
    });

    test('providers lists Apple once its secrets are set', async () => {
        const response = await dispatch('/v1/providers', { headers: { origin: 'https://app.example.com' } });
        expect(await response.json()).toEqual({ providers: ['github', 'apple'] });
        expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    });

    test('a state is good for one callback', async () => {
        const start = await startLogin('apple');
        expect((await appleCallback(start, 'apple-1002')).status).toBe(302);
        expect((await appleCallback(start, 'apple-1002')).status).toBe(400);
    });

    test('a state past its lifetime is refused', async () => {
        const start = await startLogin('apple');
        const db = await mf.getD1Database('DB');
        await db.prepare('UPDATE login_attempt SET expires_at = 0 WHERE state_hash = ?1').bind(sha256(start.providerState)).run();
        const response = await appleCallback(start, 'apple-1003');
        expect(response.status).toBe(400);
        expect(response.headers.get('location')).toBeNull();
    });

    test('a callback in another browser or without the cookie is refused', async () => {
        const start = await startLogin('apple');
        expect((await appleCallback(start, 'apple-1004', { cookie: '' })).status).toBe(400);
        const other = await startLogin('apple');
        expect((await appleCallback(other, 'apple-1004', { cookie: '__Host-pulsar-login=someone-else' })).status).toBe(400);
    });

    test('Apple answers with a post, so a GET on its callback is no route', async () => {
        const start = await startLogin('apple');
        const response = await dispatch(`/auth/apple/callback?${new URLSearchParams({ code: 'x', state: start.providerState })}`, {
            headers: { cookie: start.cookie },
            ip: start.ip
        });
        expect(response.status).toBe(404);
    });

    test('an id_token that fails any check sends the app an error and opens no account', async () => {
        const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
        const now = Math.floor(Date.now() / 1000);
        const bent: Partial<AppleCode>[] = [
            { nonce: sha256('another login') },
            { signer: otherKey },
            { claims: { aud: 'app.someone-else' } },
            { claims: { iss: 'https://evil.example.com' } },
            { claims: { exp: now - 3600 } }
        ];
        for (const code of bent) {
            const start = await startLogin('apple');
            const response = await appleCallback(start, 'apple-1005', { code });
            const back = new URL(response.headers.get('location') ?? '');
            expect(back.searchParams.get('error')).toBe('server_error');
            expect(back.searchParams.get('state')).toBe(start.appState);
            expect(back.searchParams.get('code')).toBeNull();
        }
        const db = await mf.getD1Database('DB');
        expect(await db.prepare("SELECT account_id FROM identity WHERE provider = 'apple' AND subject = 'apple-1005'").first()).toBeNull();
    });

    test('a person who cancels at Apple is sent back with access_denied', async () => {
        const start = await startLogin('apple');
        const response = await dispatch('/auth/apple/callback', {
            method: 'POST',
            form: { error: 'user_cancelled_authorize', state: start.providerState },
            headers: { cookie: start.cookie },
            ip: start.ip
        });
        const back = new URL(response.headers.get('location') ?? '');
        expect(back.searchParams.get('error')).toBe('access_denied');
        expect(back.searchParams.get('state')).toBe(start.appState);
    });
});

describe('identities', () => {
    test('an account a Worker from before identities made during a deploy gets its identity on the next sign-in', async () => {
        const db = await mf.getD1Database('DB');
        await db.prepare("INSERT INTO account (id, provider, subject, login, created_at) VALUES ('window-account', 'github', '7101', 'user-7101', 1)").run();
        const session = await signIn(7101);
        expect(session.account.id).toBe('window-account');
        expect((await accountOf(session)).identities.map((identity) => identity.provider)).toEqual(['github']);
    });

    test('a signed-in person adds Apple, and signing in with either lands on the same account', async () => {
        const session = await signIn(7201);
        const login = await linkLogin(session, 'apple', 'apple-7201');
        const linked = await completeLink(session, login);
        expect(linked.status).toBe(200);
        const result = (await linked.json()) as AccountResult;
        expect(result.identities.map((identity) => identity.provider)).toEqual(['github', 'apple']);
        // The account keeps being shown as the identity that has a login.
        expect(result.account).toEqual({ id: session.account.id, provider: 'github', login: 'user-7201' });

        const withApple = await signInWithApple('apple-7201');
        expect(withApple.account).toEqual(result.account);
        expect((await signIn(7201)).account.id).toBe(session.account.id);
    });

    test('an account made with Apple adds GitHub and is shown as the GitHub login from then on', async () => {
        const session = await signInWithApple('apple-7202');
        expect((await completeLink(session, await linkLogin(session, 'github', '7202'))).status).toBe(200);
        expect((await accountOf(session)).account).toEqual({ id: session.account.id, provider: 'github', login: 'user-7202' });
    });

    test('a link token is spent by the first start, and only works for the provider it was asked for', async () => {
        const session = await signIn(7203);
        const token = await requestLink(session, 'apple');
        const query = (link: string) =>
            new URLSearchParams({
                redirect_uri: REDIRECT_URI,
                state: base64url(randomBytes(16)),
                code_challenge: sha256('z'.repeat(43)),
                code_challenge_method: 'S256',
                link
            });
        const wrongProvider = await dispatch(`/auth/github/start?${query(token)}`);
        expect(wrongProvider.status).toBe(401);
        expect((await dispatch(`/auth/apple/start?${query(token)}`)).status).toBe(401);

        const fresh = await requestLink(session, 'apple');
        expect((await dispatch(`/auth/apple/start?${query(fresh)}`)).status).toBe(302);
        expect((await dispatch(`/auth/apple/start?${query(fresh)}`)).status).toBe(401);
        expect((await dispatch(`/auth/apple/start?${query(base64url(randomBytes(32)))}`)).status).toBe(401);
    });

    test('a link token past its lifetime, or from a session that signed out, starts nothing', async () => {
        const session = await signIn(7204);
        const db = await mf.getD1Database('DB');
        const expired = await requestLink(session, 'apple');
        await db.prepare('UPDATE identity_link_request SET expires_at = 0 WHERE token_hash = ?1').bind(sha256(expired)).run();
        const query = (link: string) =>
            new URLSearchParams({
                redirect_uri: REDIRECT_URI,
                state: base64url(randomBytes(16)),
                code_challenge: sha256('z'.repeat(43)),
                code_challenge_method: 'S256',
                link
            });
        expect((await dispatch(`/auth/apple/start?${query(expired)}`)).status).toBe(401);

        const token = await requestLink(session, 'apple');
        expect((await dispatch('/v1/session', { method: 'DELETE', headers: bearer(session) })).status).toBe(204);
        expect((await dispatch(`/auth/apple/start?${query(token)}`)).status).toBe(401);
    });

    test('the code of a link belongs to the session that asked for it, with the verifier of that login', async () => {
        const session = await signIn(7205);
        const otherSession = await signIn(7205);
        expect(otherSession.account.id).toBe(session.account.id);

        const login = await linkLogin(session, 'apple', 'apple-7205');
        const fromAnotherSession = await completeLink(otherSession, login);
        expect(fromAnotherSession.status).toBe(401);
        // Spent by that try, like a login code.
        expect((await completeLink(session, login)).status).toBe(401);

        const second = await linkLogin(session, 'apple', 'apple-7205');
        expect((await completeLink(session, second, base64url(randomBytes(32)))).status).toBe(401);

        const third = await linkLogin(session, 'apple', 'apple-7205');
        const asSession = await dispatch('/v1/session', {
            method: 'POST',
            body: { code: third.code, codeVerifier: third.start.verifier, redirectUri: REDIRECT_URI, ...bindKey(third.code, newKeyPair()) },
            ip: third.start.ip
        });
        expect(asSession.status).toBe(401);
        expect((await accountOf(session)).identities.map((identity) => identity.provider)).toEqual(['github']);
    });

    test('nothing without a session', async () => {
        expect((await dispatch('/v1/account')).status).toBe(401);
        expect((await dispatch('/v1/account/link', { method: 'POST', body: { provider: 'apple' } })).status).toBe(401);
        expect((await dispatch('/v1/account/identities', { method: 'POST', body: {} })).status).toBe(401);
        expect((await dispatch('/v1/account/identities/github', { method: 'DELETE' })).status).toBe(401);
    });

    test('an identity that signs in to another account is refused, and nothing is merged', async () => {
        const someoneElse = await signInWithApple('apple-taken');
        const session = await signIn(7206);
        const refused = await completeLink(session, await linkLogin(session, 'apple', 'apple-taken'));
        expect(refused.status).toBe(409);
        const error = ((await refused.json()) as AddressBookError).error;
        expect(error.code).toBe('identity-taken');
        expect(error.message).toBe('This Apple ID already belongs to another Ruimte account, so it was not added. Accounts are never merged.');
        expect((await accountOf(session)).identities.map((identity) => identity.provider)).toEqual(['github']);
        expect((await signInWithApple('apple-taken')).account.id).toBe(someoneElse.account.id);
    });

    test('an account adds one identity per provider', async () => {
        const session = await signIn(7207);
        const again = await dispatch('/v1/account/link', { method: 'POST', body: { provider: 'github' }, headers: bearer(session) });
        expect(again.status).toBe(409);
        expect(await errorCode(again)).toBe('provider-linked');
    });

    test('an identity comes off while another remains, and the last one stays', async () => {
        const session = await signIn(7208);
        expect((await completeLink(session, await linkLogin(session, 'apple', 'apple-7208'))).status).toBe(200);

        const unlinked = await dispatch('/v1/account/identities/apple', { method: 'DELETE', headers: bearer(session) });
        expect(unlinked.status).toBe(200);
        expect(((await unlinked.json()) as AccountResult).identities.map((identity) => identity.provider)).toEqual(['github']);

        const last = await dispatch('/v1/account/identities/github', { method: 'DELETE', headers: bearer(session) });
        expect(last.status).toBe(409);
        expect(await errorCode(last)).toBe('last-identity');
        expect((await dispatch('/v1/machines', { headers: bearer(session) })).status).toBe(200);

        expect((await dispatch('/v1/account/identities/apple', { method: 'DELETE', headers: bearer(session) })).status).toBe(404);
        // Apple on its own is a new account now.
        expect((await signInWithApple('apple-7208')).account.id).not.toBe(session.account.id);
    });

    test('the identity an account was made with can come off, and signing in with it later makes a new account', async () => {
        const session = await signInWithApple('apple-7209');
        expect((await completeLink(session, await linkLogin(session, 'github', '7209'))).status).toBe(200);
        expect((await dispatch('/v1/account/identities/apple', { method: 'DELETE', headers: bearer(session) })).status).toBe(200);
        const fresh = await signInWithApple('apple-7209');
        expect(fresh.account.id).not.toBe(session.account.id);
        expect((await signIn(7209)).account.id).toBe(session.account.id);
    });
});

describe('the identity migration', () => {
    let old: Miniflare;

    beforeAll(async () => {
        old = new Miniflare({
            modules: true,
            script,
            compatibilityDate: '2026-08-01',
            d1Databases: { DB: 'pulsar-migration' },
            bindings: { PUBLIC_ORIGIN, GITHUB_CLIENT_ID: 'github-client', GITHUB_CLIENT_SECRET: GITHUB_SECRET, ...APPLE_BINDINGS },
            outboundService: outbound
        });
        await migrate(old, (file) => file < '0005');
    }, 30_000);

    afterAll(async () => {
        await old.dispose();
    });

    test('a GitHub account from before keeps its session and machines, and signs in to the same account', async () => {
        const db = await old.getD1Database('DB');
        const accessToken = base64url(randomBytes(32));
        const now = Date.now();
        await db.batch([
            db.prepare("INSERT INTO account (id, provider, subject, login, created_at) VALUES ('before', 'github', '9001', 'user-before', 1)"),
            db
                .prepare(
                    `INSERT INTO session (id, account_id, label, access_hash, access_expires_at, refresh_hash, expires_at, created_at, session_key)
                     VALUES ('session-before', 'before', 'Old device', ?1, ?2, ?3, ?4, 1, ?5)`
                )
                .bind(sha256(accessToken), now + 10 * 60_000, sha256(base64url(randomBytes(32))), now + 24 * 60 * 60_000, newKeyPair().publicKey),
            db.prepare(
                "INSERT INTO machine (account_id, id, name, icon, public_key, last_seen_at, created_at) VALUES ('before', 'machine-before', 'Old machine', NULL, 'key', 1, 1)"
            )
        ]);

        await migrate(old, (file) => file >= '0005');

        const headers = { authorization: `Bearer ${accessToken}` };
        const account = await dispatch('/v1/account', { headers, on: old });
        expect(account.status).toBe(200);
        expect(await account.json()).toEqual({
            account: { id: 'before', provider: 'github', login: 'user-before' },
            identities: [{ provider: 'github', login: 'user-before', createdAt: 1 }]
        });
        const machines = (await (await dispatch('/v1/machines', { headers, on: old })).json()) as MachineListResult;
        expect(machines.machines.map((machine) => machine.id)).toEqual(['machine-before']);

        const again = await signIn(9001, newKeyPair(), old);
        expect(again.account).toEqual({ id: 'before', provider: 'github', login: 'user-9001' });
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

    test('native Apple routes fail closed before reading an attempt without signing credentials', async () => {
        for (const path of ['/v1/apple/start', '/v1/apple/complete']) {
            const response = await dispatch(path, { method: 'POST', on: bare, body: {} });
            expect(response.status).toBe(503);
            expect(await errorCode(response)).toBe('not-configured');
        }
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
            message: 'Signing in with GitHub is not configured on this address book yet'
        });
        const health = (await bare.dispatchFetch(`${PUBLIC_ORIGIN}/health`)) as unknown as Response;
        expect(await health.json()).toEqual({ ok: true, statementKey: null, providers: { github: false, apple: false } });
        const providers = (await bare.dispatchFetch(`${PUBLIC_ORIGIN}/v1/providers`)) as unknown as Response;
        expect(await providers.json()).toEqual({ providers: [] });
    });
});
