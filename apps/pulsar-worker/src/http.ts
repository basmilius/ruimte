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
    'machine-on-other-account': 409,
    'identity-taken': 409,
    'provider-linked': 409,
    'last-identity': 409,
    'confirmation-mismatch': 400,
    'apple-revocation-failed': 502,
    'rate-limited': 429,
    'clock-skew': 400,
    'not-configured': 503,
    'no-benchmarks': 503,
    internal: 500
};

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
    const outgoing = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    new Headers(headers).forEach((value, name) => outgoing.set(name, value));
    return new Response(JSON.stringify(body), { status, headers: outgoing });
}

export function failure(code: AddressBookErrorCode, message: string, headers: HeadersInit = {}): Response {
    return json({ error: { code, message } }, STATUS_OF[code], headers);
}

export function noContent(): Response {
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

export function clientIp(request: Request): string {
    return request.headers.get('cf-connecting-ip') ?? 'unknown';
}

// A parsed body, or the response that says why there is none.
export async function readBody<T>(request: Request, schema: z.ZodType<T>, maxBytes = MAX_BODY_BYTES): Promise<{ value: T } | { response: Response }> {
    const text = await request.text();
    if (text.length > maxBytes) {
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
}

const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/;

/* `DESKTOP_APP_ORIGIN` in `@ruimte/contracts`, which the worker does not depend on. */
const DESKTOP_APP_ORIGIN = 'app://ruimte';

/*
 * The desktop app serves the client on its own scheme, Vite serves it on loopback in dev. Tokens are
 * bearer and never cookies, so this is about which pages may read the answers, not about forged requests.
 */
export function allowedOrigin(request: Request, env: Env): string | null {
    const origin = request.headers.get('origin');
    if (!origin) {
        return null;
    }
    if (origin === DESKTOP_APP_ORIGIN || LOOPBACK_ORIGIN.test(origin)) {
        return origin;
    }
    const extra = (env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    return extra.includes(origin) ? origin : null;
}

export function corsHeaders(origin: string | null): Record<string, string> {
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
}
