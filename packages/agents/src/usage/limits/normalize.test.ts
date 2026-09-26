import { describe, expect, test } from 'bun:test';
import { kindOfDuration, mergeWindows, readClaudeEvent, readClaudeUsage, readCodexLimits } from './normalize.ts';

const claudeAnswer = {
    session: { total_cost_usd: 1.5 },
    subscription_type: 'max',
    rate_limits_available: true,
    rate_limits: {
        five_hour: { utilization: 23, resets_at: '2026-09-10T22:09:59.670610+00:00' },
        seven_day: { utilization: 88, resets_at: '2026-09-12T07:59:59.670632+00:00' },
        seven_day_opus: null,
        seven_day_sonnet: null,
        model_scoped: [{ display_name: 'Fable', utilization: 4, resets_at: null }]
    }
};

describe('what Claude answers', () => {
    test('turns a percent and an ISO moment into a fraction and epoch milliseconds', () => {
        const reading = readClaudeUsage(claudeAnswer);
        expect('unavailable' in reading).toBe(false);
        if ('unavailable' in reading) {
            return;
        }
        expect(reading.plan).toBe('max');
        expect(reading.cost).toEqual({ sessionUsd: 1.5 });
        expect(reading.windows).toHaveLength(3);
        expect(reading.windows[0]).toEqual({
            id: 'five_hour',
            label: 'Session',
            kind: 'session',
            used: 0.23,
            resetsAt: Date.parse('2026-09-10T22:09:59.670610+00:00'),
            durationMs: 5 * 60 * 60_000
        });
        expect(reading.windows[1]!.used).toBe(0.88);
        expect(reading.windows[2]).toMatchObject({ id: 'seven_day_fable', label: 'Weekly · Fable', kind: 'weekly', resetsAt: null });
    });

    test('an account without a plan is unavailable and not a failure', () => {
        expect(readClaudeUsage({ rate_limits_available: false, rate_limits: null })).toEqual({ unavailable: { reason: 'no-subscription', message: null } });
        expect(readClaudeUsage('nothing')).toMatchObject({ unavailable: { reason: 'failed' } });
    });

    test('the event of a running turn carries a fraction and seconds instead', () => {
        const update = readClaudeEvent({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.31, resetsAt: 1_789_000_000 });
        expect(update).toEqual({
            kind: 'claude',
            windows: [{ id: 'five_hour', label: 'Session', kind: 'session', durationMs: 5 * 60 * 60_000, used: 0.31, resetsAt: 1_789_000_000_000 }]
        });
        expect(readClaudeEvent({ status: 'allowed' })).toBeNull();
    });
});

describe('what Codex answers', () => {
    const snapshot = {
        limitId: 'codex',
        planType: 'pro',
        primary: { usedPercent: 96, windowDurationMins: 10080, resetsAt: 1_789_453_149 },
        secondary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1_789_100_000 }
    };

    test('names a window after how long it lasts, not after the position it came in', () => {
        const reading = readCodexLimits(snapshot)!;
        expect(reading.plan).toBe('pro');
        expect(reading.windows[0]).toEqual({
            id: 'primary',
            kind: 'weekly',
            label: 'Weekly',
            used: 0.96,
            resetsAt: 1_789_453_149_000,
            durationMs: 10_080 * 60_000
        });
        expect(reading.windows[1]).toMatchObject({ id: 'secondary', kind: 'session', label: 'Session', used: 0.12 });
    });

    test('skips the budget of one model, which is not the plan', () => {
        expect(readCodexLimits({ ...snapshot, limitId: 'codex_bengalfox' })).toBeNull();
        expect(readCodexLimits(null)).toBeNull();
    });

    test('a window without a length is named after nothing', () => {
        const reading = readCodexLimits({ limitId: 'codex', primary: { usedPercent: 5 } })!;
        expect(reading.windows[0]).toMatchObject({ kind: 'other', label: 'Usage', durationMs: null, resetsAt: null });
        expect(kindOfDuration(31 * 24 * 60 * 60_000)).toBe('monthly');
    });
});

describe('folding an update onto a reading', () => {
    const known = [
        { id: 'five_hour', kind: 'session' as const, label: 'Session', used: 0.2, resetsAt: 1_000, durationMs: 5 * 60 * 60_000 },
        { id: 'seven_day', kind: 'weekly' as const, label: 'Weekly', used: 0.5, resetsAt: 2_000, durationMs: 7 * 24 * 60 * 60_000 }
    ];

    test('keeps the reset and the length the event leaves out', () => {
        const merged = mergeWindows(known, [{ id: 'five_hour', used: 0.31 }]);
        expect(merged[0]).toEqual({ ...known[0]!, used: 0.31 });
        expect(merged[1]).toEqual(known[1]!);
    });

    test('a window nobody drew yet is added, and one without a number is ignored', () => {
        expect(mergeWindows(known, [{ id: 'overage', used: 0.1 }])).toHaveLength(3);
        expect(mergeWindows(known, [{ id: 'five_hour' }])[0]!.used).toBe(0.2);
    });
});
