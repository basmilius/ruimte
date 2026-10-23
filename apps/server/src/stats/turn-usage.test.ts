import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { ChatInfo, ChatItem } from '@ruimte/contracts';
import { TurnUsage } from './turn-usage.ts';
import { UsageCounter } from './usage-counter.ts';
import { installUsageCounter } from './usage-stats.ts';

type TurnItem = Extract<ChatItem, { kind: 'turn' }>;

const INFO: Pick<ChatInfo, 'provider' | 'model' | 'selection' | 'permissionMode' | 'runtimeMode' | 'effectiveRuntimeMode'> = {
    provider: 'claude',
    model: 'claude-opus-5-5',
    selection: { model: 'opus', options: {} },
    runtimeMode: 'auto-accept-edits'
};

let clock: number;
let counter: UsageCounter;

function turn(id: string, state: TurnItem['state'], limit?: TurnItem['limit']): TurnItem {
    return { id, kind: 'turn', state, createdAt: 0, endedAt: null, costUsd: 0, ...(limit === undefined ? {} : { limit }) } as TurnItem;
}

function day() {
    clock += 86_400_000;
    return counter.finished()[0]!;
}

beforeEach(() => {
    clock = Date.parse('2026-10-14T10:00:00Z');
    counter = new UsageCounter({
        store: { read: async () => null, write: async () => undefined },
        describe: () => ({ version: '1.2.3', launcher: 'desktop' }),
        now: () => clock,
        schedule: () => () => undefined
    });
    installUsageCounter(counter);
});

afterEach(() => installUsageCounter(null));

test('a turn counts once by provider, model family and mode, and its first words time the wait', () => {
    const usage = new TurnUsage(() => clock);
    usage.turn('chat', turn('t1', 'running'), INFO);
    usage.turn('chat', turn('t1', 'running'), INFO);
    clock += 1400;
    usage.words('chat', 'claude');
    clock += 500;
    usage.words('chat', 'claude');
    usage.turn('chat', turn('t2', 'running'), { ...INFO, permissionMode: 'plan' });
    const counted = day();
    expect(counted.counts).toEqual({ 'turns.claude': 2, 'turns.model.opus': 2, 'turns.mode.autoAcceptEdits': 1, 'turns.mode.plan': 1 });
    expect(counted.timings).toEqual({ 'firstTokenMs.claude': [1400] });
});

test('a turn that stopped on a usage limit counts the limit once, and the next turn counts as work taken up again', () => {
    const usage = new TurnUsage(() => clock);
    usage.turn('chat', turn('t1', 'running'), INFO);
    usage.turn('chat', turn('t1', 'error', { kind: 'usage', resetsAt: 1 }), INFO);
    usage.turn('chat', turn('t1', 'error', { kind: 'usage', resetsAt: 1 }), INFO);
    usage.turn('chat', turn('t2', 'running'), INFO);
    usage.turn('chat', turn('t2', 'error', { kind: 'overload' }), INFO);
    usage.turn('chat', turn('t3', 'running'), INFO);
    expect(day().counts).toMatchObject({ 'limits.claude': 1, limitResumes: 1, 'turns.claude': 3 });
});
