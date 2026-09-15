import {
    LoginStartQuerySchema,
    PROVIDER_NAMES,
    SessionExchangePayloadSchema,
    SessionRefreshPayloadSchema,
    sessionKeyMessage,
    type ProviderId
} from '@ruimte/pulsar';
import { verifyEd25519 } from './crypto.ts';
import { randomToken, sha256 } from './encoding.ts';
import type { Env } from './env.ts';
import { clientIp, failure, json, noContent, readBody } from './http.ts';
import { resolveAccount, spendLinkToken, storeLinkCode } from './identities.ts';
import type { OAuthProvider } from './providers.ts';
import { LIMITS, overAnyLimit } from './rate-limit.ts';
import { accountLoginSql, accountProviderSql, authenticate, createSession, revokeSession, rotateSession, type AccountRow } from './sessions.ts';

// Long enough to type a password and a second factor at the provider.
const LOGIN_ATTEMPT_LIFETIME_MS = 10 * 60_000;
// The app exchanges the code the moment the redirect lands.
const LOGIN_CODE_LIFETIME_MS = 60_000;

/*
 * Ties the callback to the browser that opened the start URL. The app's PKCE already keeps a code from
 * working for anyone else; this also keeps someone from finishing a login in another person's browser.
 */
const BROWSER_COOKIE = '__Host-pulsar-login';

const callbackUrl = (env: Env, provider: OAuthProvider): string => `${env.PUBLIC_ORIGIN}/auth/${provider.id}/callback`;

const notConfigured = (provider: OAuthProvider): Response =>
    failure('not-configured', `Signing in with ${PROVIDER_NAMES[provider.id]} is not configured on this address book yet`);

/*
 * `SameSite=None` only for a provider that answers with a cross-site form post, where a `Lax` cookie
 * would stay behind. Still `__Host-`, `Secure` and `HttpOnly`, and the callback needs the single-use
 * state beside it, so a forged post finds nothing to finish.
 */
const loginCookie = (provider: OAuthProvider, value: string, maxAgeSeconds: number): string =>
    `${BROWSER_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=${provider.callbackMethod === 'POST' ? 'None' : 'Lax'}; Max-Age=${maxAgeSeconds}`;

const cookieOf = (request: Request, name: string): string | null => {
    for (const part of (request.headers.get('cookie') ?? '').split(';')) {
        const [key, ...value] = part.trim().split('=');
        if (key === name) {
            return value.join('=');
        }
    }
    return null;
};

// Shown in the browser when there is no app to send the browser back to.
const loginPage = (status: number, message: string): Response =>
    new Response(`${message}\n`, {
        status,
        headers: {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
            'set-cookie': `${BROWSER_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`
        }
    });

const redirectToApp = (appRedirectUri: string, params: Record<string, string>): Response =>
    new Response(null, {
        status: 302,
        headers: {
            location: `${appRedirectUri}?${new URLSearchParams(params).toString()}`,
            'cache-control': 'no-store',
            'set-cookie': `${BROWSER_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`
        }
    });

// `GET /auth/<provider>/start`, opened by the app in the system browser.
export const startLogin = async (request: Request, env: Env, provider: OAuthProvider): Promise<Response> => {
    const limited = await overAnyLimit(env.DB, [[`ip:${clientIp(request)}:login`, LIMITS.loginIp]]);
    if (limited) {
        return limited;
    }
    if (!provider.configured(env)) {
        return notConfigured(provider);
    }
    const parsed = LoginStartQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return failure('bad-request', issue ? `${issue.path.join('.')}: ${issue.message}` : 'The login query does not match');
    }
    const query = parsed.data;
    // Spent here, before the provider is ever asked, so a token that leaks from this URL is gone once the app opened it.
    const link = query.link === undefined ? null : await spendLinkToken(env.DB, query.link, provider.id);
    if (query.link !== undefined && link === null) {
        return failure('unauthorized', 'This link to add a sign-in expired or was already used. Start again from Ruimte.');
    }
    const now = Date.now();
    const state = randomToken();
    const browser = randomToken();
    // The address book is a PKCE client of the provider too, so a code that leaks from the callback URL is worth nothing on its own.
    const providerVerifier = randomToken();
    await env.DB.prepare(
        `INSERT INTO login_attempt (state_hash, provider, browser_hash, provider_verifier, app_redirect_uri, app_state, app_code_challenge, created_at, expires_at,
             link_account_id, link_session_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
    )
        .bind(
            await sha256(state),
            provider.id,
            await sha256(browser),
            providerVerifier,
            query.redirect_uri,
            query.state,
            query.code_challenge,
            now,
            now + LOGIN_ATTEMPT_LIFETIME_MS,
            link?.accountId ?? null,
            link?.sessionId ?? null
        )
        .run();
    const location = provider.authorizeUrl(env, { state, codeChallenge: await sha256(providerVerifier), redirectUri: callbackUrl(env, provider) });
    return new Response(null, {
        status: 302,
        headers: {
            location,
            'cache-control': 'no-store',
            'set-cookie': loginCookie(provider, browser, LOGIN_ATTEMPT_LIFETIME_MS / 1000)
        }
    });
};

interface LoginAttemptRow {
    provider: ProviderId;
    browser_hash: string;
    provider_verifier: string;
    app_redirect_uri: string;
    app_state: string;
    app_code_challenge: string;
    expires_at: number;
    link_account_id: string | null;
    link_session_id: string | null;
}

// The provider's answer: in the query for a redirect, in the body for a form post.
const callbackParams = async (request: Request): Promise<URLSearchParams> => {
    if (request.method !== 'POST') {
        return new URL(request.url).searchParams;
    }
    const text = await request.text();
    return new URLSearchParams(text.length > 16 * 1024 ? '' : text);
};

// `GET` or `POST /auth/<provider>/callback`, where the provider sends the browser.
export const finishLogin = async (request: Request, env: Env, provider: OAuthProvider): Promise<Response> => {
    const limited = await overAnyLimit(env.DB, [[`ip:${clientIp(request)}:login`, LIMITS.loginIp]]);
    if (limited) {
        return limited;
    }
    if (!provider.configured(env)) {
        return notConfigured(provider);
    }
    const params = await callbackParams(request);
    const state = params.get('state');
    if (!state) {
        return loginPage(400, 'This sign-in link is not complete. Start signing in again from Ruimte.');
    }
    // Deleted on the first read, so a state is spent whether this callback succeeds or not.
    const attempt = await env.DB.prepare('DELETE FROM login_attempt WHERE state_hash = ?1 RETURNING *')
        .bind(await sha256(state))
        .first<LoginAttemptRow>();
    const browser = cookieOf(request, BROWSER_COOKIE);
    if (!attempt || attempt.expires_at <= Date.now() || attempt.provider !== provider.id || !browser || (await sha256(browser)) !== attempt.browser_hash) {
        return loginPage(400, 'This sign-in expired, was already used or was started in another browser. Start signing in again from Ruimte.');
    }
    const code = params.get('code');
    if (params.get('error') || !code) {
        return redirectToApp(attempt.app_redirect_uri, { error: 'access_denied', state: attempt.app_state });
    }
    let identity;
    try {
        identity = await provider.identify(env, { code, codeVerifier: attempt.provider_verifier, redirectUri: callbackUrl(env, provider) });
    } catch (error) {
        console.error('provider refused the login', error);
        return redirectToApp(attempt.app_redirect_uri, { error: 'server_error', state: attempt.app_state });
    }
    if (attempt.link_account_id !== null && attempt.link_session_id !== null) {
        const linkCode = await storeLinkCode(env.DB, {
            link: { accountId: attempt.link_account_id, sessionId: attempt.link_session_id },
            provider: provider.id,
            identity,
            appRedirectUri: attempt.app_redirect_uri,
            appCodeChallenge: attempt.app_code_challenge
        });
        return redirectToApp(attempt.app_redirect_uri, { code: linkCode, state: attempt.app_state });
    }
    const accountId = await resolveAccount(env.DB, provider.id, identity);
    if (!accountId) {
        return redirectToApp(attempt.app_redirect_uri, { error: 'server_error', state: attempt.app_state });
    }
    const loginCode = randomToken();
    await env.DB.prepare('INSERT INTO login_code (code_hash, account_id, app_redirect_uri, app_code_challenge, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)')
        .bind(await sha256(loginCode), accountId, attempt.app_redirect_uri, attempt.app_code_challenge, Date.now() + LOGIN_CODE_LIFETIME_MS)
        .run();
    return redirectToApp(attempt.app_redirect_uri, { code: loginCode, state: attempt.app_state });
};

// `POST /v1/session`: the app trades the code from the redirect for a session.
export const exchangeLoginCode = async (request: Request, env: Env): Promise<Response> => {
    const limited = await overAnyLimit(env.DB, [[`ip:${clientIp(request)}:session`, LIMITS.sessionIp]]);
    if (limited) {
        return limited;
    }
    const body = await readBody(request, SessionExchangePayloadSchema);
    if ('response' in body) {
        return body.response;
    }
    const { code, codeVerifier, redirectUri, label, sessionKey, sessionKeySignature } = body.value;
    // Spent on the first try, so a guessed or stolen verifier gets one attempt at most.
    const row = await env.DB.prepare(
        `DELETE FROM login_code WHERE code_hash = ?1 RETURNING app_redirect_uri, app_code_challenge, expires_at,
             (SELECT id FROM account WHERE account.id = login_code.account_id) AS account_id,
             ${accountProviderSql('login_code.account_id')} AS provider,
             ${accountLoginSql('login_code.account_id')} AS login`
    )
        .bind(await sha256(code))
        .first<{
            app_redirect_uri: string;
            app_code_challenge: string;
            expires_at: number;
            account_id: string | null;
            provider: ProviderId;
            login: string | null;
        }>();
    if (!row || !row.account_id || row.expires_at <= Date.now()) {
        return failure('unauthorized', 'The login code expired or was already used');
    }
    if (row.app_redirect_uri !== redirectUri || (await sha256(codeVerifier)) !== row.app_code_challenge) {
        return failure('unauthorized', 'The login code belongs to another login');
    }
    // After the code is spent, so a key that does not sign costs the login rather than leaving the code for another try.
    if (!(await verifyEd25519(sessionKey, sessionKeyMessage(code, sessionKey), sessionKeySignature))) {
        return failure('bad-signature', 'The session key did not sign this login');
    }
    const account: AccountRow = { id: row.account_id, provider: row.provider, login: row.login };
    return json(await createSession(env.DB, account, label ?? null, sessionKey));
};

// `POST /v1/session/refresh`
export const refreshSession = async (request: Request, env: Env): Promise<Response> => {
    const limited = await overAnyLimit(env.DB, [[`ip:${clientIp(request)}:session`, LIMITS.sessionIp]]);
    if (limited) {
        return limited;
    }
    const body = await readBody(request, SessionRefreshPayloadSchema);
    if ('response' in body) {
        return body.response;
    }
    const result = await rotateSession(env.DB, body.value);
    return result ? json(result) : failure('unauthorized', 'Sign in again');
};

// `DELETE /v1/session`
export const endSession = async (request: Request, env: Env): Promise<Response> => {
    const session = await authenticate(request, env.DB);
    if (!session) {
        return failure('unauthorized', 'Sign in again');
    }
    await revokeSession(env.DB, session.id);
    return noContent();
};
