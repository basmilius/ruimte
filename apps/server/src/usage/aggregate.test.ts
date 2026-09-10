import { describe, expect, test } from 'bun:test';
import { aggregate } from './aggregate.ts';
import { PriceBook } from './pricing.ts';
import type { UsageRecord } from './record.ts';

const prices = new PriceBook('/nowhere', false);

const record = (patch: Partial<UsageRecord> & { at: string }): UsageRecord => ({
    provider: 'claude',
    timestampMs: Date.parse(patch.at),
    model: 'claude-opus-4-5',
    sessionId: 's-1',
    cwd: '/work/repo',
    totals: { calls: 1, input: 100, cacheRead: 1_000, cacheWrite: 50, cacheWrite1h: 0, output: 40, reasoning: 10 },
    dedupeKey: null,
    ...patch
});

const week = { from: '2026-09-04', to: '2026-09-10', resolution: 'day', timeZone: 'Europe/Amsterdam' } as const;

describe('the aggregation', () => {
    test('buckets in the days of the viewer, not in UTC', async () => {
        // Half past eleven in the evening in Amsterdam is still the tenth; in UTC it is not.
        const records = [record({ at: '2026-09-10T21:30:00.000Z' }), record({ at: '2026-09-09T21:30:00.000Z' })];
        const { buckets } = await aggregate(records, week, prices, []);
        expect(buckets.map((bucket) => bucket.slot)).toEqual(['2026-09-09', '2026-09-10']);
        const utc = await aggregate(records, { ...week, timeZone: 'UTC' }, prices, []);
        expect(utc.buckets.map((bucket) => bucket.slot)).toEqual(['2026-09-09', '2026-09-10']);
    });

    test('leaves out what falls outside the period', async () => {
        const records = [record({ at: '2026-09-10T09:00:00.000Z' }), record({ at: '2026-08-01T09:00:00.000Z' })];
        const { buckets, models } = await aggregate(records, week, prices, []);
        expect(buckets).toHaveLength(1);
        expect(models[0]!.totals.calls).toBe(1);
    });

    test('splits a slot per provider and per model and counts the sessions of each', async () => {
        const records = [
            record({ at: '2026-09-10T09:00:00.000Z' }),
            record({ at: '2026-09-10T10:00:00.000Z', sessionId: 's-2' }),
            record({ at: '2026-09-10T11:00:00.000Z', provider: 'codex', model: 'gpt-5.6', sessionId: 'c-1' })
        ];
        const { buckets, sessions } = await aggregate(records, week, prices, []);
        expect(buckets).toHaveLength(2);
        expect(buckets[0]!.sessions).toBe(2);
        expect(buckets[0]!.totals.calls).toBe(2);
        expect(sessions).toBe(3);
    });

    test('groups the hours of one day when that is what was asked', async () => {
        const today = { from: '2026-09-10', to: '2026-09-10', resolution: 'hour', timeZone: 'Europe/Amsterdam' } as const;
        const records = [record({ at: '2026-09-10T09:10:00.000Z' }), record({ at: '2026-09-10T09:50:00.000Z' }), record({ at: '2026-09-10T12:00:00.000Z' })];
        const { buckets } = await aggregate(records, today, prices, []);
        expect(buckets.map((bucket) => bucket.slot)).toEqual(['2026-09-10T11', '2026-09-10T14']);
        expect(buckets[0]!.totals.calls).toBe(2);
    });

    test('prices what it can and leaves the rest null with a basis that says why', async () => {
        const records = [record({ at: '2026-09-10T09:00:00.000Z' }), record({ at: '2026-09-10T09:00:00.000Z', model: 'model-nobody-sells' })];
        const { models, buckets } = await aggregate(records, week, prices, []);
        const unpriced = models.find((model) => model.model === 'model-nobody-sells')!;
        expect(unpriced.costUsd).toBeNull();
        expect(unpriced.priceBasis).toBe('unknown');
        // Unpriced sorts last, so the row with a number is on top.
        expect(models.at(-1)).toBe(unpriced);
        expect(buckets.find((bucket) => bucket.model === 'claude-opus-4-5')!.costUsd).toBeGreaterThan(0);
    });

    test('folds a directory onto the project it belongs to and keeps a share per provider', async () => {
        const known = [{ projectId: 'p1', name: 'Ruimte', folder: '/work/repo' }];
        const records = [
            record({ at: '2026-09-10T09:00:00.000Z' }),
            record({ at: '2026-09-10T09:00:00.000Z', provider: 'codex', model: 'gpt-5.6' }),
            record({ at: '2026-09-10T09:00:00.000Z', cwd: '/work/other' })
        ];
        const { projects } = await aggregate(records, week, prices, known);
        const mine = projects.find((project) => project.folder === '/work/repo')!;
        expect(mine.name).toBe('Ruimte');
        expect(mine.projectId).toBe('p1');
        expect(Object.keys(mine.byProvider).sort()).toEqual(['claude', 'codex']);
        expect(projects.find((project) => project.folder === '/work/other')!.projectId).toBeNull();
    });
});
