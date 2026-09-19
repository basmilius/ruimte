import { APP_REDIRECT_SCHEME_URI, NativeAppleCompletePayloadSchema, NativeAppleStartPayloadSchema, randomToken, sha256 } from '@ruimte/pulsar';
import { identifyNativeApple, nativeAppleConfigured } from './apple.ts';
import type { Env } from './env.ts';
import { clientIp, failure, json, readBody } from './http.ts';
import { resolveAccount } from './identities.ts';
import { LIMITS, overAnyLimit } from './rate-limit.ts';

const ATTEMPT_LIFETIME_MS = 10 * 60_000;
const CODE_LIFETIME_MS = 60_000;

const available = async (request: Request, env: Env): Promise<Response | null> => {
    const limited = await overAnyLimit(env.DB, [[`ip:${clientIp(request)}:login`, LIMITS.loginIp]]);
    if (limited) {
        return limited;
    }
    return nativeAppleConfigured(env) ? null : failure('not-configured', 'Signing in with Apple is not configured on this address book yet');
};

export const startNativeApple = async (request: Request, env: Env): Promise<Response> => {
    const refused = await available(request, env);
    if (refused) {
        return refused;
    }
    const body = await readBody(request, NativeAppleStartPayloadSchema);
    if ('response' in body) {
        return body.response;
    }
    const attempt = randomToken();
    const nonce = randomToken();
    const expiresAt = Date.now() + ATTEMPT_LIFETIME_MS;
    await env.DB.prepare('INSERT INTO native_apple_login (attempt_hash, nonce, code_challenge, expires_at) VALUES (?1, ?2, ?3, ?4)')
        .bind(await sha256(attempt), nonce, body.value.codeChallenge, expiresAt)
        .run();
    return json({ attempt, nonce, expiresAt });
};

export const completeNativeApple = async (request: Request, env: Env): Promise<Response> => {
    const refused = await available(request, env);
    if (refused) {
        return refused;
    }
    const body = await readBody(request, NativeAppleCompletePayloadSchema, 32 * 1024);
    if ('response' in body) {
        return body.response;
    }
    // Invalid Apple credentials spend the attempt too; concurrent completions get one verifier between them.
    const attempt = await env.DB.prepare('DELETE FROM native_apple_login WHERE attempt_hash = ?1 RETURNING nonce, code_challenge, expires_at')
        .bind(await sha256(body.value.attempt))
        .first<{ nonce: string; code_challenge: string; expires_at: number }>();
    if (!attempt || attempt.expires_at <= Date.now()) {
        return failure('unauthorized', 'This Apple sign-in expired or was already used. Start again.');
    }
    let subject: string;
    try {
        subject = await identifyNativeApple(env, { ...body.value, nonce: attempt.nonce });
    } catch {
        return failure('unauthorized', 'Apple could not verify this sign-in. Start again.');
    }
    if (attempt.expires_at <= Date.now()) {
        return failure('unauthorized', 'This Apple sign-in expired. Start again.');
    }
    const accountId = await resolveAccount(env.DB, 'apple', { subject, login: null });
    if (!accountId) {
        return failure('internal', 'The account could not be opened. Start signing in again.');
    }
    const code = randomToken();
    await env.DB.prepare('INSERT INTO login_code (code_hash, account_id, app_redirect_uri, app_code_challenge, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)')
        .bind(await sha256(code), accountId, APP_REDIRECT_SCHEME_URI, attempt.code_challenge, Date.now() + CODE_LIFETIME_MS)
        .run();
    return json({ code });
};
