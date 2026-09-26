import { describe, expect, test } from 'bun:test';
import type { UsageBucket, UsageSummaryResult, UsageTotals } from '@ruimte/contracts';
import { formatTokens, formatUsd, moneyFormat, shortPath } from '@ruimte/agents-react/usage/format';
import { deriveDays, deriveUsage, enumerateSlots, labelEveryFor } from './summary.ts';

const totals = (patch: Partial<UsageTotals> = {}): UsageTotals => ({
    calls: 1,
    input: 100,
    cacheRead: 900,
    cacheWrite: 50,
    cacheWrite1h: 0,
    output: 40,
    reasoning: 10,
    ...patch
});

const bucket = (patch: Partial<UsageBucket>): UsageBucket => ({
    slot: '2026-09-10',
    provider: 'claude',
    model: 'claude-opus-5',
    totals: totals(),
    costUsd: 1,
    cacheSavingsUsd: 0.25,
    sessions: 1,
    ...patch
});

const summary = (buckets: UsageBucket[], patch: Partial<UsageSummaryResult> = {}): UsageSummaryResult => ({
    from: '2026-09-08',
    to: '2026-09-10',
    resolution: 'day',
    timeZone: 'Europe/Amsterdam',
    buckets,
    models: [],
    projects: [],
    sessions: 3,
    scan: { at: 0, files: 0, changedFiles: 0, durationMs: 0, running: false, failed: false },
    pricing: { source: 'litellm', fetchedAt: null, models: 0 },
    rate: null,
    roots: [],
    ...patch
});

describe('the slots of a period', () => {
    test('a day period keeps every calendar day, including the empty ones', () => {
        expect(enumerateSlots({ from: '2026-09-08', to: '2026-09-10', resolution: 'day' })).toEqual(['2026-09-08', '2026-09-09', '2026-09-10']);
    });

    test('a period that spans a month end counts on', () => {
        expect(enumerateSlots({ from: '2026-08-30', to: '2026-09-01', resolution: 'day' })).toEqual(['2026-08-30', '2026-08-31', '2026-09-01']);
    });

    test('today is the 24 hours of one day', () => {
        const slots = enumerateSlots({ from: '2026-09-10', to: '2026-09-10', resolution: 'hour' });
        expect(slots).toHaveLength(24);
        expect(slots[0]).toBe('2026-09-10T00');
        expect(slots.at(-1)).toBe('2026-09-10T23');
    });

    test('the x axis thins out as the period grows', () => {
        expect(labelEveryFor(7)).toBe(1);
        expect(labelEveryFor(24)).toBe(3);
        expect(labelEveryFor(30)).toBe(7);
        expect(labelEveryFor(90)).toBe(15);
    });
});

describe('the derivation', () => {
    const buckets = [
        bucket({ slot: '2026-09-08', costUsd: 2 }),
        bucket({ slot: '2026-09-10', costUsd: 3 }),
        bucket({ slot: '2026-09-10', provider: 'codex', model: 'gpt-5.6', costUsd: 1 })
    ];

    test('stacks a slot per provider and keeps the empty ones in place', () => {
        const derived = deriveUsage(summary(buckets), 'cost');
        expect(derived.slots.map((slot) => slot.total)).toEqual([2, 0, 4]);
        expect(derived.slots[2]!.byProvider).toEqual({ claude: 3, codex: 1 });
        expect(derived.active).toEqual(['claude', 'codex']);
    });

    test('measures in tokens when that is the metric', () => {
        const derived = deriveUsage(summary(buckets), 'tokens');
        expect(derived.slots[0]!.total).toBe(1_090);
        expect(derived.totals.calls).toBe(3);
    });

    test('an unpriced bucket counts its tokens and nothing towards the cost', () => {
        const derived = deriveUsage(summary([bucket({ costUsd: null })]), 'cost');
        expect(derived.costUsd).toBe(0);
        expect(derived.totals.output).toBe(40);
    });

    test('sorts the provider rows by what they cost', () => {
        const derived = deriveUsage(summary([bucket({ costUsd: 1 }), bucket({ provider: 'codex', model: 'gpt-5.6', costUsd: 9 })]), 'cost');
        expect(derived.providers.map((provider) => provider.provider)).toEqual(['codex', 'claude']);
    });

    test('a bucket outside the slots of the period still counts towards the totals', () => {
        const derived = deriveUsage(summary([bucket({ slot: '2026-01-01', costUsd: 5 })]), 'cost');
        expect(derived.costUsd).toBe(5);
        expect(derived.slots.every((slot) => slot.total === 0)).toBe(true);
    });
});

describe('the day table', () => {
    test('folds the providers of a slot together, newest first', () => {
        const rows = deriveDays(
            summary([
                bucket({ slot: '2026-09-08', costUsd: 2 }),
                bucket({ slot: '2026-09-10', costUsd: 3 }),
                bucket({ slot: '2026-09-10', provider: 'codex', model: 'gpt-5.6', costUsd: 1 })
            ])
        );
        expect(rows.map((row) => row.slot)).toEqual(['2026-09-10', '2026-09-08']);
        expect(rows[0]!.costByProvider).toEqual({ claude: 3, codex: 1 });
        expect(rows[0]!.costUsd).toBe(4);
        expect(rows[0]!.tokens).toBe(2_180);
    });

    test('leaves out the days nothing happened in', () => {
        expect(deriveDays(summary([])).length).toBe(0);
    });

    test('the hours of today fold onto the one day they belong to', () => {
        const rows = deriveDays(
            summary([bucket({ slot: '2026-09-10T09', costUsd: 2 }), bucket({ slot: '2026-09-10T14', costUsd: 3 })], { resolution: 'hour' })
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]!.slot).toBe('2026-09-10');
        expect(rows[0]!.costUsd).toBe(5);
    });

    test('an unpriced bucket still puts its tokens on the row', () => {
        const rows = deriveDays(summary([bucket({ costUsd: null })]));
        expect(rows[0]!.costUsd).toBe(0);
        expect(rows[0]!.tokens).toBe(1_090);
    });
});

/* The page formats in the region of the machine, so these pin the rules and not one region's commas. */
describe('the formatters', () => {
    test('a token count reads as a size', () => {
        expect(formatTokens(640)).toBe('640');
        expect(formatTokens(412_000)).toBe('412K');
        expect(formatTokens(1_240_000)).toMatch(/^1[.,]2M$/);
        expect(formatTokens(11_900_000)).toBe('12M');
    });

    test('an amount under a cent keeps enough decimals to not read as zero', () => {
        expect(formatUsd(142.181)).toMatch(/142[.,]18$/);
        expect(formatUsd(0)).toMatch(/0[.,]00$/);
        expect(formatUsd(0.0004)).toMatch(/0[.,]0004$/);
    });

    test('euros are the dollar amount at the rate the summary carries', () => {
        const money = moneyFormat('EUR', { currency: 'EUR', rate: 0.5, date: '2026-09-10', fetchedAt: 0 });
        expect(money(10)).toMatch(/^€\s?5[.,]00$|5[.,]00\s?€$/);
    });

    test('without a rate it stays in dollars rather than mislabeling one', () => {
        const money = moneyFormat('EUR', null);
        expect(money(10)).toMatch(/10[.,]00/);
        expect(money(10)).not.toContain('€');
    });
});

describe('a folder under a project row', () => {
    test('keeps the tail that tells two checkouts apart', () => {
        expect(shortPath('/Users/bas/Development/Projects/ruimte')).toBe('…/Development/Projects/ruimte');
        expect(shortPath('/work/repo')).toBe('/work/repo');
    });
});
