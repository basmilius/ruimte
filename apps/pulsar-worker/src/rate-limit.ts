import { failure } from './http.ts';

const WINDOW_MS = 60_000;

/*
 * Requests per minute for the routes that sign, mint or verify something. A person signs in once and
 * asks for a statement per connection attempt, and the daemon's reconnect loop tops out at one attempt
 * per 10 seconds, so these are only ever met by a script.
 */
export const LIMITS = {
    loginIp: 20,
    sessionIp: 30,
    registerAccount: 20,
    registerIp: 30,
    statementAccount: 30,
    statementIp: 60
} as const;

/*
 * A fixed window in D1 rather than the platform's rate limiting binding, which counts per location and
 * lets a burst through while it catches up. One upsert per request on these routes is cheap next to the
 * signature they guard.
 */
export const overLimit = async (db: D1Database, bucket: string, limit: number, now = Date.now()): Promise<Response | null> => {
    const windowStart = now - (now % WINDOW_MS);
    const row = await db
        .prepare(
            'INSERT INTO rate_limit (bucket, window_start, count) VALUES (?1, ?2, 1) ON CONFLICT (bucket, window_start) DO UPDATE SET count = count + 1 RETURNING count'
        )
        .bind(bucket, windowStart)
        .first<{ count: number }>();
    if (row && row.count > limit) {
        const retryAfter = Math.ceil((windowStart + WINDOW_MS - now) / 1000);
        return failure('rate-limited', `Too many requests, try again in ${retryAfter} s`, { 'retry-after': String(retryAfter) });
    }
    return null;
};

// The first limit that is over, checking every bucket so each one counts this request.
export const overAnyLimit = async (db: D1Database, checks: ReadonlyArray<readonly [bucket: string, limit: number]>): Promise<Response | null> => {
    const now = Date.now();
    const results = await Promise.all(checks.map(([bucket, limit]) => overLimit(db, bucket, limit, now)));
    return results.find((result) => result !== null) ?? null;
};
