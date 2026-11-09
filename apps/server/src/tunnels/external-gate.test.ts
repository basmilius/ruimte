import { describe, expect, test } from 'bun:test';
import { FailureLimiter } from './external-gate.ts';

function failTimes(limiter: FailureLimiter, source: string, times: number): void {
    for (let i = 0; i < times; i++) {
        limiter.fail(source);
    }
}

describe('the failure limiter', () => {
    test('blocks a source after twenty failures in a minute, and forgets them afterwards', () => {
        const clock = { now: 1_000 };
        const limiter = new FailureLimiter(() => clock.now);

        failTimes(limiter, 'a', 19);
        expect(limiter.blocked('a')).toBe(false);

        limiter.fail('a');
        expect(limiter.blocked('a')).toBe(true);
        expect(limiter.blocked('b')).toBe(false);

        clock.now += 61_000;

        expect(limiter.blocked('a')).toBe(false);
    });

    test('once the sources overflow, the shared bucket blocks every source that is not tracked', () => {
        const limiter = new FailureLimiter(() => 1_000, 2);

        limiter.fail('a');
        limiter.fail('b');
        // The map is full, so these share one bucket.
        failTimes(limiter, 'c', 10);
        failTimes(limiter, 'd', 10);

        expect(limiter.blocked('e')).toBe(true);
        expect(limiter.blocked('c')).toBe(true);
        // A source the limiter already tracks counts on its own.
        expect(limiter.blocked('a')).toBe(false);
    });

    test('a flood from many sources does not grow the map past its capacity', () => {
        const limiter = new FailureLimiter(() => 1_000, 3);

        for (let i = 0; i < 50; i++) {
            limiter.fail(`source-${i}`);
        }

        expect((limiter as unknown as { failures: Map<string, number[]> }).failures.size).toBeLessThanOrEqual(4);
    });
});
