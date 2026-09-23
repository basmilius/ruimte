import { describe, expect, test } from 'bun:test';
import { ActionRegistry } from '@ruimte/actions';
import { EMPTY_TOTALS, type ProcessAlert, type ProcessesSampleEvent, type UsageSummaryResult } from '@ruimte/contracts';
import { PERSON_ACTION_CALL, VOICE_ACTION_CALL } from './client-actions';
import { machineActions, type MachineReach } from './machine-actions';
import type { Transport } from '@/transport/transport';

const sample: ProcessesSampleEvent = {
    at: 100,
    scope: 'ruimte',
    machine: { cores: 8, cpu: 12, memoryUsed: 4_000, memoryTotal: 16_000, diskRead: null, diskWrite: null, diskFree: null, diskTotal: null },
    groups: [
        {
            id: 'chat-1',
            kind: 'chat',
            nodeId: 'chat-1',
            cpu: 90,
            memory: 2_000,
            diskRead: null,
            diskWrite: null,
            hidden: 0,
            processes: [
                {
                    pid: 1,
                    startTime: 1,
                    ppid: 0,
                    name: 'claude',
                    path: null,
                    readable: true,
                    cpu: 10,
                    memory: 500,
                    diskRead: null,
                    diskWrite: null,
                    family: 'claude',
                    depth: 0
                },
                {
                    pid: 2,
                    startTime: 2,
                    ppid: 1,
                    name: 'node',
                    path: null,
                    readable: true,
                    cpu: 80,
                    memory: 1_500,
                    diskRead: null,
                    diskWrite: null,
                    family: 'claude',
                    depth: 1
                }
            ]
        }
    ],
    fine: null,
    coarse: null,
    reset: false
};

const alert: ProcessAlert = { id: 'alert-1', kind: 'busy-after-turn', nodeId: 'chat-1', pid: 2, startTime: 2, name: 'node', since: 50, value: 80 };

const usage: UsageSummaryResult = {
    from: '2026-09-17',
    to: '2026-09-23',
    resolution: 'day',
    timeZone: 'Europe/Amsterdam',
    buckets: [],
    models: [
        { provider: 'claude', model: 'big', totals: { ...EMPTY_TOTALS, input: 100, output: 50 }, costUsd: 2, priceBasis: 'exact', pricedAs: null },
        { provider: 'codex', model: 'unpriced', totals: { ...EMPTY_TOTALS, input: 10 }, costUsd: null, priceBasis: 'unknown', pricedAs: null }
    ],
    projects: [{ folder: '/work/atlas', name: 'atlas', projectId: null, byProvider: {}, totals: { ...EMPTY_TOTALS, input: 110, output: 50 }, costUsd: 2 }],
    sessions: 3,
    scan: { at: 1, files: 1, changedFiles: 0, durationMs: 1, running: false, failed: false },
    pricing: { source: 'snapshot', fetchedAt: null, models: 1 },
    rate: null,
    roots: []
};

const fake = (overrides: Partial<MachineReach> = {}) => {
    const requests: { type: string; payload: unknown }[] = [];
    const transport = {
        request: async (type: string, payload: unknown) => {
            requests.push({ type, payload });
            if (type === 'usage.summary') {
                return usage;
            }
            if (type === 'usage.limits') {
                return {
                    providers: [
                        {
                            kind: 'claude',
                            plan: 'max',
                            checkedAt: 1,
                            source: 'probe',
                            windows: [{ id: 'w', kind: 'session', label: '5h', used: 0.42, resetsAt: 9, durationMs: null }],
                            cost: null,
                            unavailable: null
                        }
                    ]
                };
            }
            return {};
        }
    } as unknown as Transport;
    const registry = new ActionRegistry<void>(
        machineActions({
            transport: () => transport,
            sample: () => sample,
            alerts: () => [alert],
            limits: () => null,
            titles: () => new Map([['chat-1', 'Research']]),
            now: () => new Date(2026, 8, 23, 12),
            timeZone: () => 'Europe/Amsterdam',
            ...overrides
        })
    );
    return { registry, requests };
};

describe('machine actions', () => {
    test('reads the busiest processes per node under its title, and says when nothing measures', async () => {
        const { registry } = fake();
        expect(await registry.execute('process.list', { limit: 1 }, VOICE_ACTION_CALL)).toMatchObject({
            output: { cpu: 12, groups: [{ name: 'Research', processes: [{ pid: 2, name: 'node' }], more: 1 }] }
        });
        const idle = fake({ sample: () => null });
        expect(await idle.registry.execute('process.list', { limit: null }, VOICE_ACTION_CALL)).toMatchObject({ error: { code: 'not-measured' } });
    });

    test('Voice reads and dismisses a warning, and never signals a process', async () => {
        const { registry, requests } = fake();
        expect(await registry.execute('process.alerts', {}, VOICE_ACTION_CALL)).toMatchObject({
            output: { alerts: [{ alertId: 'alert-1', kind: 'busy-after-turn', node: 'Research', process: 'node', value: 80 }] }
        });
        expect(await registry.execute('process.dismissAlert', { alertId: 'alert-1' }, VOICE_ACTION_CALL)).toMatchObject({ status: 'completed' });
        expect(await registry.execute('process.dismissAlert', { alertId: 'gone' }, VOICE_ACTION_CALL)).toMatchObject({ error: { code: 'unknown-alert' } });
        expect(await registry.execute('process.signal', { pid: 2, startTime: 2, name: 'node', signal: 'SIGTERM' }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'forbidden-action' }
        });
        expect(requests).toEqual([{ type: 'processes.dismiss', payload: { id: 'alert-1' } }]);
    });

    test('a person terminates at once, and a force quit waits for the answer to its question', async () => {
        const { registry, requests } = fake();
        await registry.execute('process.signal', { pid: 2, startTime: 2, name: 'node', signal: 'SIGTERM' }, PERSON_ACTION_CALL);
        const asked = await registry.execute('process.signal', { pid: 2, startTime: 2, name: 'node', signal: 'SIGKILL' }, PERSON_ACTION_CALL);
        expect(asked.status).toBe('needs_confirmation');
        expect(requests).toEqual([{ type: 'processes.signal', payload: { pid: 2, startTime: 2, signal: 'SIGTERM' } }]);
        if (asked.status === 'needs_confirmation') {
            await registry.confirm(asked.confirmationToken, true, PERSON_ACTION_CALL);
        }
        expect(requests.at(-1)).toEqual({ type: 'processes.signal', payload: { pid: 2, startTime: 2, signal: 'SIGKILL' } });
    });

    test('usage defaults to the last seven days and keeps an unknown price apart from free', async () => {
        const { registry, requests } = fake();
        expect(await registry.execute('usage.summary', { from: null, to: null }, VOICE_ACTION_CALL)).toMatchObject({
            output: {
                tokens: 160,
                costUsd: 2,
                sessions: 3,
                providers: [
                    { provider: 'claude', tokens: 150, costUsd: 2 },
                    { provider: 'codex', tokens: 10, costUsd: null }
                ],
                models: [{ model: 'big' }, { model: 'unpriced' }],
                projects: [{ name: 'atlas', tokens: 160, costUsd: 2 }]
            }
        });
        expect(requests[0]).toEqual({
            type: 'usage.summary',
            payload: { from: '2026-09-17', to: '2026-09-23', resolution: 'day', timeZone: 'Europe/Amsterdam' }
        });
        expect(await registry.execute('usage.summary', { from: '2026-09-23', to: '2026-09-01' }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'backwards' }
        });
    });

    test('plan windows come from what the window holds, and only asked of the machine without it', async () => {
        const { registry, requests } = fake();
        expect(await registry.execute('usage.limits', {}, VOICE_ACTION_CALL)).toMatchObject({
            output: { providers: [{ provider: 'claude', plan: 'max', windows: [{ label: '5h', usedPercent: 42, resetsAt: 9 }] }] }
        });
        expect(requests.map((request) => request.type)).toEqual(['usage.limits']);
        const held = fake({ limits: () => ({ providers: [] }) });
        expect(await held.registry.execute('usage.limits', {}, VOICE_ACTION_CALL)).toMatchObject({ output: { providers: [] } });
        expect(held.requests).toEqual([]);
    });
});
