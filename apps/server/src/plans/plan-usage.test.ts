import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageCounter } from '../stats/usage-counter.ts';
import { installUsageCounter } from '../stats/usage-stats.ts';
import { PlanStore } from './plan-store.ts';

let home: string;
let clock: number;
let counter: UsageCounter;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-plan-usage-'));
    clock = Date.parse('2026-10-14T10:00:00Z');
    counter = new UsageCounter({
        store: { read: async () => null, write: async () => undefined },
        describe: () => ({ version: '1.2.3', launcher: 'desktop' }),
        now: () => clock,
        schedule: () => () => undefined
    });
    installUsageCounter(counter);
});

afterEach(async () => {
    installUsageCounter(null);
    await rm(home, { recursive: true, force: true });
});

test('a plan counts once it is written, and a dry run or a refused draft counts nothing', async () => {
    const plans = new PlanStore(home, { now: () => clock });
    const draft = { meta: { title: 'Release' }, items: [{ type: 'step' as const, title: 'Write the tests' }] };
    expect(await plans.create('chat', { draft, dryRun: true })).toMatchObject({ ok: true });
    expect(await plans.create('chat', { draft: { items: [{ type: 'nonsense' }] } as never })).toMatchObject({ ok: false });
    expect(await plans.create('chat', { draft })).toMatchObject({ ok: true });
    clock += 86_400_000;
    expect(counter.finished()[0]?.counts).toEqual({ 'plans.created': 1 });
});
