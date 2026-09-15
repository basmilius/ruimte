import { failure } from './http.ts';
import { retryAfterSeconds, windowStartOf } from './rate-window.ts';

export { LIMITS } from './rate-window.ts';

/*
 * A fixed window in D1 rather than the platform's rate limiting binding, which counts per location and
 * lets a burst through while it catches up. One upsert per request on these routes is cheap next to the
 * signature they guard.
 */
export const overLimit = async (db: D1Database, bucket: string, limit: number, now = Date.now()): Promise<Response | null> => {
    const windowStart = windowStartOf(now);
    const row = await db
        .prepare(
            'INSERT INTO rate_limit (bucket, window_start, count) VALUES (?1, ?2, 1) ON CONFLICT (bucket, window_start) DO UPDATE SET count = count + 1 RETURNING count'
        )
        .bind(bucket, windowStart)
        .first<{ count: number }>();
    if (row && row.count > limit) {
        const retryAfter = retryAfterSeconds(now);
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
