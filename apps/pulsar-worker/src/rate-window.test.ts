import { describe, expect, test } from 'bun:test';
import { LIMITS, PERIOD_SECONDS, rateLimitBindingOf } from './rate-window.ts';

interface RateLimitConfig {
    name: string;
    namespace_id: string;
    simple: { limit: number; period: number };
}

const config = Bun.JSONC.parse(await Bun.file(new URL('../wrangler.jsonc', import.meta.url)).text()) as { ratelimits: RateLimitConfig[] };

describe('the rate limit bindings', () => {
    test('every limit has a binding in wrangler.jsonc that counts that many per minute', () => {
        for (const limit of new Set(Object.values(LIMITS))) {
            const binding = config.ratelimits.find((entry) => entry.name === rateLimitBindingOf(limit));
            expect(binding?.simple).toEqual({ limit, period: PERIOD_SECONDS });
        }
    });

    test('no two bindings share a namespace, so no two limits share a counter', () => {
        const namespaces = config.ratelimits.map((entry) => entry.namespace_id);
        expect(new Set(namespaces).size).toBe(namespaces.length);
    });
});
