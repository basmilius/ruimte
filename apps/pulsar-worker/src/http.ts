import type { AddressBookErrorCode } from '@ruimte/pulsar';
import type { z } from 'zod';
import type { Env } from './env.ts';

// Every body the address book accepts is a few hundred bytes; this only keeps a large one from being parsed.
const MAX_BODY_BYTES = 16 * 1024;

const STATUS_OF: Record<AddressBookErrorCode, number> = {
    'bad-request': 400,
    unauthorized: 401,
    'bad-signature': 403,
    'not-found': 404,
    removed: 409,
    'identity-taken': 409,
    'provider-linked': 409,
    'last-identity': 409,
    'rate-limited': 429,
    'not-configured': 503,
    internal: 500
};

export const json = (body: unknown, status = 200, headers: HeadersInit = {}): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

export const failure = (code: AddressBookErrorCode, message: string, headers: HeadersInit = {}): Response =>
    json({ error: { code, message } }, STATUS_OF[code], headers);

export const noContent = (): Response => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });

export const clientIp = (request: Request): string => request.headers.get('cf-connecting-ip') ?? 'unknown';

// A parsed body, or the response that says why there is none.
export const readBody = async <T>(request: Request, schema: z.ZodType<T>): Promise<{ value: T } | { response: Response }> => {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
        return { response: failure('bad-request', 'The body is too large') };
    }
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return { response: failure('bad-request', 'The body is not JSON') };
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return { response: failure('bad-request', issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'The body does not match') };
    }
    return { value: parsed.data };
};

const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/;

/*
 * The client runs from the daemon it came with (`http://127.0.0.1:<port>` in the desktop app) or from
 * Vite in dev, so loopback is what a page needs. Tokens are bearer and never cookies, so this is about
 * which pages may read the answers, not about forged requests.
 */
export const allowedOrigin = (request: Request, env: Env): string | null => {
    const origin = request.headers.get('origin');
    if (!origin) {
        return null;
    }
    if (LOOPBACK_ORIGIN.test(origin)) {
        return origin;
    }
    const extra = (env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    return extra.includes(origin) ? origin : null;
};

export const corsHeaders = (origin: string | null): Record<string, string> => {
    if (!origin) {
        return { vary: 'Origin' };
    }
    return {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET, POST, DELETE',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-max-age': '600',
        vary: 'Origin'
    };
};
