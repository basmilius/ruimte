import { describe, expect, test } from 'bun:test';
import { readNanoGptUsage } from './nanogpt-plan.ts';

describe('what a NanoGPT subscription answers', () => {
    const answer = {
        active: true,
        state: 'active',
        limits: { dailyInputTokens: 10_000_000, weeklyInputTokens: 60_000_000, dailyImages: null },
        dailyInputTokens: { used: 2_500_000, remaining: 7_500_000, percentUsed: 0.25, resetAt: 1_792_000_000_000, degraded: false },
        weeklyInputTokens: { used: 66_000_000, remaining: 0, percentUsed: 1.1, resetAt: 1_792_300_000_000, degraded: false },
        dailyImages: null,
        period: { currentPeriodEnd: '2026-11-01T00:00:00.000Z' }
    };

    test('turns each counter into a window named after how long it lasts', () => {
        const reading = readNanoGptUsage(answer);
        if ('unavailable' in reading) {
            throw new Error('expected a reading');
        }
        expect(reading.plan).toBe('Subscription');
        expect(reading.windows).toEqual([
            { id: 'daily_input', label: 'Daily', kind: 'session', used: 0.25, resetsAt: 1_792_000_000_000, durationMs: 24 * 60 * 60_000 },
            // A fraction past one is an allowance that ran out, drawn as full.
            { id: 'weekly_input', label: 'Weekly', kind: 'weekly', used: 1, resetsAt: 1_792_300_000_000, durationMs: 7 * 24 * 60 * 60_000 }
        ]);
    });

    test('works the fraction out of the amounts when the API leaves it out', () => {
        const reading = readNanoGptUsage({
            ...answer,
            dailyInputTokens: { used: 5_000_000, remaining: 5_000_000, percentUsed: null, resetAt: null, degraded: false }
        });
        if ('unavailable' in reading) {
            throw new Error('expected a reading');
        }
        expect(reading.windows[0]).toMatchObject({ id: 'daily_input', used: 0.5, resetsAt: null });
    });

    test('leaves out a counter that could not be read, since unknown is not empty', () => {
        const reading = readNanoGptUsage({ ...answer, weeklyInputTokens: { used: null, remaining: null, percentUsed: null, resetAt: null, degraded: true } });
        if ('unavailable' in reading) {
            throw new Error('expected a reading');
        }
        expect(reading.windows.map((window) => window.id)).toEqual(['daily_input']);
    });

    test('says a subscription that is not active has no plan, and a grace period by its name', () => {
        expect(readNanoGptUsage({ ...answer, active: false, state: 'inactive' })).toEqual({
            unavailable: { reason: 'no-subscription', message: 'The NanoGPT subscription is not active.' }
        });
        const grace = readNanoGptUsage({ ...answer, state: 'grace' });
        expect('unavailable' in grace ? null : grace.plan).toBe('Grace period');
    });

    test('an answer that is not an object is a failed read', () => {
        expect(readNanoGptUsage('nope')).toMatchObject({ unavailable: { reason: 'failed' } });
    });
});
