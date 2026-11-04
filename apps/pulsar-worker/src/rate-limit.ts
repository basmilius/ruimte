import type { z } from 'zod';
import type { Env } from './env.ts';
import { clientIp, failure, readBody, signInAgain } from './http.ts';
import { PERIOD_SECONDS, rateLimitBindingOf, type RateLimitValue } from './rate-window.ts';
import { authenticate, type SessionContext } from './sessions.ts';

export { LIMITS } from './rate-window.ts';

/*
 * The platform's limiter counts per location and catches up after a burst, so a script can get a little
 * past a limit. That is accepted here for every route: it writes nothing, where a counter in D1 cost an
 * upsert per request and a delete per window.
 */
export async function overLimit(env: Env, bucket: string, limit: RateLimitValue): Promise<Response | null> {
    const { success } = await env[rateLimitBindingOf(limit)].limit({ key: bucket });
    if (success) {
        return null;
    }
    // The limiter does not say when its window ends, so this is the longest wait.
    return failure('rate-limited', `Too many requests, try again in ${PERIOD_SECONDS} s`, { 'retry-after': String(PERIOD_SECONDS) });
}

// The first limit that is over, checking every bucket so each one counts this request.
export async function overAnyLimit(env: Env, checks: ReadonlyArray<readonly [bucket: string, limit: RateLimitValue]>): Promise<Response | null> {
    const results = await Promise.all(checks.map(([bucket, limit]) => overLimit(env, bucket, limit)));
    return results.find((result) => result !== null) ?? null;
}

/* The body of a request from an address within a route's limit, or the answer that turns it down. */
export async function bodyWithinLimit<T>(
    request: Request,
    env: Env,
    ip: readonly [bucket: string, limit: RateLimitValue],
    schema: z.ZodType<T>
): Promise<{ value: T } | { response: Response }> {
    const limited = await overAnyLimit(env, [[`ip:${clientIp(request)}:${ip[0]}`, ip[1]]]);
    return limited ? { response: limited } : readBody(request, schema);
}

/* The session of a signed-in request within a route's limit for its account and for its address, or the answer that turns it down. */
export async function sessionWithinLimits(
    request: Request,
    env: Env,
    account: readonly [bucket: string, limit: RateLimitValue],
    ip: readonly [bucket: string, limit: RateLimitValue]
): Promise<SessionContext | Response> {
    const session = await authenticate(request, env.DB);
    if (!session) {
        return signInAgain();
    }
    const limited = await overAnyLimit(env, [
        [`account:${session.account.id}:${account[0]}`, account[1]],
        [`ip:${clientIp(request)}:${ip[0]}`, ip[1]]
    ]);
    return limited ?? session;
}
