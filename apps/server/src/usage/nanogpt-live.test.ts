import { describe, expect, test } from 'bun:test';
import type { UsageWindow } from '@ruimte/contracts';
import type { ProbeResult } from '@adecore/agents/usage';
import { followPlan } from './nanogpt-live.ts';

function reading(used: number): ProbeResult {
    const window: UsageWindow = { id: 'weekly_input', kind: 'weekly', label: 'Weekly', used, resetsAt: 2_000, durationMs: 7 * 24 * 60 * 60_000 };
    return { plan: 'Subscription', windows: [window], cost: null };
}

/* A read that answers when the test lets it, so calls can arrive while a question is out. */
function gate() {
    const waiting: Array<(result: ProbeResult | Error) => void> = [];
    return {
        read: () =>
            new Promise<ProbeResult>((resolve, reject) => {
                waiting.push((result) => (result instanceof Error ? reject(result) : resolve(result)));
            }),
        answer: (result: ProbeResult | Error) => waiting.shift()!(result),
        pending: () => waiting.length
    };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('following a subscription quota', () => {
    test('a call puts the answer of the API on the bar', async () => {
        const applied: Array<{ plan: string | null; used: number }> = [];
        const call = followPlan(async () => reading(0.05), { apply: ({ plan, windows }) => applied.push({ plan, used: windows[0]!.used }) });
        call();
        await flush();
        expect(applied).toEqual([{ plan: 'Subscription', used: 0.05 }]);
    });

    test('calls that come while a question is out share the next one, after a pause', async () => {
        const quota = gate();
        const pauses: number[] = [];
        const applied: number[] = [];
        const call = followPlan(quota.read, { apply: ({ windows }) => applied.push(windows[0]!.used) }, async (ms) => {
            pauses.push(ms);
        });
        call();
        call();
        call();
        expect(quota.pending()).toBe(1);

        quota.answer(reading(0.1));
        await flush();
        // One more question for the three calls, not one each.
        expect(pauses).toEqual([2000]);
        expect(quota.pending()).toBe(1);
        quota.answer(reading(0.2));
        await flush();
        expect(applied).toEqual([0.1, 0.2]);
        expect(quota.pending()).toBe(0);
    });

    test('a failed question or a missing key changes nothing and the next call asks again', async () => {
        const quota = gate();
        const applied: number[] = [];
        const call = followPlan(quota.read, { apply: ({ windows }) => applied.push(windows[0]!.used) });
        call();
        quota.answer(new Error('offline'));
        await flush();
        call();
        quota.answer({ unavailable: { reason: 'no-subscription', message: 'Add a NanoGPT API key in Settings.' } });
        await flush();
        call();
        quota.answer(reading(0.3));
        await flush();
        expect(applied).toEqual([0.3]);
    });
});
