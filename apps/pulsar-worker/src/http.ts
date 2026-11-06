import { ADDRESS_BOOK_ERROR_STATUS, corsHeaders as corsHeadersFor, failureOf } from '@ruimte/pulsar';
import type { z } from 'zod';

// Every body the address book accepts is a few hundred bytes; this only keeps a large one from being parsed.
const MAX_BODY_BYTES = 16 * 1024;

export { allowedOrigin, json } from '@ruimte/pulsar';

export const failure = failureOf(ADDRESS_BOOK_ERROR_STATUS);

export const corsHeaders = corsHeadersFor('GET, POST, DELETE');

/* A session token that is missing, expired or revoked. */
export function signInAgain(): Response {
    return failure('unauthorized', 'Sign in again');
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
