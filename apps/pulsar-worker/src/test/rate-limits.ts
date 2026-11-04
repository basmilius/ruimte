import { LIMITS, rateLimitBindingOf, type RateLimitBinding, type RateLimiter } from '../rate-window.ts';

/*
 * The limiters of every distinct limit, counting each key exactly and never forgetting it, so a test meets
 * a limit after the same number of requests the platform allows in one minute.
 */
export function fakeRateLimits(): Record<RateLimitBinding, RateLimiter> {
    const limiters = {} as Record<RateLimitBinding, RateLimiter>;
    for (const limit of new Set(Object.values(LIMITS))) {
        const counts = new Map<string, number>();
        limiters[rateLimitBindingOf(limit)] = {
            limit: async ({ key }) => {
                const count = (counts.get(key) ?? 0) + 1;
                counts.set(key, count);
                return { success: count <= limit };
            }
        };
    }
    return limiters;
}
