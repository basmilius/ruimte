import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import type { EventMap, EventType, RequestMap, RequestType, Snooze } from '@ruimte/contracts';
import { TransportError, type Transport, type TransportStatus } from '@/transport/transport';
import { isSnoozed, MAX_TICK_MS, snoozeOf, nextWake, observeWaiting, snoozeUntil, startSnoozeClock, useSnoozes, watchSnoozes, withoutExpired } from './snooze';

const at = (year: number, month: number, day: number, hour: number, minute = 0): number => new Date(year, month - 1, day, hour, minute).getTime();

describe('when a snooze runs out', () => {
    test('ten minutes and an hour count from the moment it was set', () => {
        const now = at(2026, 9, 24, 14, 5);
        expect(snoozeUntil('ten-minutes', now)).toBe(at(2026, 9, 24, 14, 15));
        expect(snoozeUntil('hour', now)).toBe(at(2026, 9, 24, 15, 5));
    });

    test('tomorrow is nine in the morning of the next day', () => {
        expect(snoozeUntil('tomorrow', at(2026, 9, 24, 14, 5))).toBe(at(2026, 9, 25, 9));
        expect(snoozeUntil('tomorrow', at(2026, 9, 30, 9))).toBe(at(2026, 10, 1, 9));
    });

    test('tomorrow set in the night wakes the same morning', () => {
        expect(snoozeUntil('tomorrow', at(2026, 9, 25, 2))).toBe(at(2026, 9, 25, 9));
    });
});

describe('whether a node is snoozed', () => {
    const snoozes = { 'local:t1': 1_000, 'Xk3p:t1': 5_000 };

    test('holds until its moment and not a millisecond after', () => {
        expect(isSnoozed(snoozes, 'local:t1', 999)).toBe(true);
        expect(isSnoozed(snoozes, 'local:t1', 1_000)).toBe(false);
    });

    test('the snooze standing on a node is the one of its own machine', () => {
        expect(snoozeOf(snoozes, 'local', 't1')).toBe(1_000);
        expect(snoozeOf(snoozes, 'local', 't2')).toBeNull();
    });

    test('is about the node on one machine only', () => {
        expect(isSnoozed(snoozes, 'local:t2', 0)).toBe(false);
        expect(isSnoozed(snoozes, 'Xk3p:t1', 2_000)).toBe(true);
    });

    test('the next wake is the first one still ahead', () => {
        expect(nextWake(snoozes, 0)).toBe(1_000);
        expect(nextWake(snoozes, 1_000)).toBe(5_000);
        expect(nextWake(snoozes, 5_000)).toBeNull();
    });

    test('what ran out is dropped, and nothing running out keeps the same object', () => {
        expect(withoutExpired(snoozes, 1_000)).toEqual({ 'Xk3p:t1': 5_000 });
        expect(withoutExpired(snoozes, 999)).toBe(snoozes);
    });
});

describe('a snooze that ends early', () => {
    const snoozes = { 'local:t1': 10_000 };

    test('ends once the node was seen waiting and then stops', () => {
        const first = observeWaiting(snoozes, new Set(), new Map([['local:t1', true]]));
        expect(first.forget).toEqual([]);
        const second = observeWaiting(snoozes, first.waiting, new Map([['local:t1', false]]));
        expect(second.forget).toEqual(['local:t1']);
        expect(second.waiting.has('local:t1')).toBe(false);
    });

    test('stays while the node was never seen waiting, as right after a reload', () => {
        expect(observeWaiting(snoozes, new Set(), new Map([['local:t1', false]])).forget).toEqual([]);
    });

    test('a node nobody snoozed is not remembered', () => {
        expect(observeWaiting(snoozes, new Set(), new Map([['local:t2', true]])).waiting.size).toBe(0);
    });

    test('a node that is not observed keeps its snooze', () => {
        const first = observeWaiting(snoozes, new Set(), new Map([['local:t1', true]]));
        expect(observeWaiting(snoozes, first.waiting, new Map()).forget).toEqual([]);
    });
});

describe('the snooze clock', () => {
    let now = 0;
    let stop: () => void = () => {};

    beforeEach(() => {
        jest.useFakeTimers();
        now = 0;
        useSnoozes.setState({ byKey: {}, onMachine: {} });
    });

    afterEach(() => {
        stop();
        jest.useRealTimers();
    });

    const advance = (ms: number): void => {
        now += ms;
        jest.advanceTimersByTime(ms);
    };

    test('takes a snooze out the moment it runs out', () => {
        stop = startSnoozeClock(() => now);
        useSnoozes.getState().snooze('local', 't1', 30_000);
        advance(29_999);
        expect(useSnoozes.getState().byKey).toEqual({ 'local:t1': 30_000 });
        advance(1);
        expect(useSnoozes.getState().byKey).toEqual({});
    });

    test('reads the wall clock again at least once a minute, so a sleeping machine wakes it late by no more than that', () => {
        stop = startSnoozeClock(() => now);
        useSnoozes.getState().snooze('local', 't1', 10 * MAX_TICK_MS);
        // The machine slept: the wall clock jumps past the snooze while the timer has barely moved.
        now = 11 * MAX_TICK_MS;
        jest.advanceTimersByTime(MAX_TICK_MS);
        expect(useSnoozes.getState().byKey).toEqual({});
    });

    test('drops what ran out while the clock was not running', () => {
        useSnoozes.setState({ byKey: { 'local:t1': 500, 'local:t2': 5_000 } });
        now = 1_000;
        stop = startSnoozeClock(() => now);
        expect(useSnoozes.getState().byKey).toEqual({ 'local:t2': 5_000 });
    });
});

class FakeTransport implements Transport {
    status: TransportStatus = 'closed';
    held: Snooze[] = [];
    /* A machine from before snoozes reached it. */
    older = false;
    readonly sent: { type: RequestType; payload: unknown }[] = [];
    private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
    private readonly statusHandlers = new Set<(status: TransportStatus) => void>();

    request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        if (this.older) {
            return Promise.reject(new TransportError('unknown-request', `Unknown request type: ${type}`));
        }
        this.sent.push({ type, payload });
        if (type === 'snooze.list') {
            return Promise.resolve({ snoozes: this.held } as RequestMap[T]['result']);
        }
        return Promise.resolve({} as RequestMap[T]['result']);
    }

    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void {
        const set = this.handlers.get(event) ?? new Set();
        this.handlers.set(event, set);
        set.add(handler as (payload: unknown) => void);
        return () => set.delete(handler as (payload: unknown) => void);
    }

    subscribeStatus(handler: (status: TransportStatus) => void): () => void {
        this.statusHandlers.add(handler);
        return () => this.statusHandlers.delete(handler);
    }

    open(): void {
        this.status = 'open';
        for (const handler of this.statusHandlers) {
            handler('open');
        }
    }

    emit<E extends EventType>(event: E, payload: EventMap[E]): void {
        for (const handler of this.handlers.get(event) ?? []) {
            handler(payload);
        }
    }
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('snoozes a machine keeps', () => {
    let transport: FakeTransport;
    let stop: () => void = () => {};
    let stored: Map<string, string>;
    const before = globalThis.localStorage;
    const later = Date.now() + 3_600_000;
    const storedSnoozes = (): unknown => JSON.parse(stored.get('ruimte.snoozes') ?? '{}');

    beforeEach(() => {
        transport = new FakeTransport();
        stored = new Map();
        globalThis.localStorage = {
            getItem: (key: string) => stored.get(key) ?? null,
            setItem: (key: string, value: string) => {
                stored.set(key, value);
            }
        } as Storage;
        useSnoozes.setState({ byKey: {}, onMachine: {} });
    });

    afterEach(() => {
        stop();
        globalThis.localStorage = before;
    });

    test('come from the machine and follow its changes', async () => {
        transport.held = [{ projectId: 'p1', nodeId: 't1', until: later }];
        stop = watchSnoozes('Xk3p', transport);
        transport.open();
        await settle();
        expect(useSnoozes.getState().byKey).toEqual({ 'Xk3p:t1': later });
        transport.emit('snooze.changed', { snoozes: [{ projectId: 'p1', nodeId: 't2', until: later }] });
        expect(useSnoozes.getState().byKey).toEqual({ 'Xk3p:t2': later });
    });

    test('a snooze set or ended here is sent to the machine and kept out of this client storage', async () => {
        stop = watchSnoozes('Xk3p', transport);
        transport.open();
        await settle();
        useSnoozes.getState().snooze('Xk3p', 't1', later);
        useSnoozes.getState().unsnooze('Xk3p', 't1');
        useSnoozes.getState().snooze('Xk3p', 't2', later);
        expect(transport.sent.slice(1)).toEqual([
            { type: 'snooze.set', payload: { nodeId: 't1', until: later } },
            { type: 'snooze.clear', payload: { nodeId: 't1' } },
            { type: 'snooze.set', payload: { nodeId: 't2', until: later } }
        ]);
        expect(storedSnoozes()).toEqual({});
    });

    test('what this client kept before goes to the machine once and leaves the storage', async () => {
        useSnoozes.getState().snooze('Xk3p', 't1', later);
        useSnoozes.getState().snooze('local', 't9', later);
        transport.held = [];
        stop = watchSnoozes('Xk3p', transport);
        transport.open();
        await settle();
        expect(transport.sent.filter((request) => request.type === 'snooze.set')).toEqual([{ type: 'snooze.set', payload: { nodeId: 't1', until: later } }]);
        expect(useSnoozes.getState().byKey).toEqual({ 'Xk3p:t1': later, 'local:t9': later });
        expect(storedSnoozes()).toEqual({ 'local:t9': later });
        transport.open();
        await settle();
        expect(transport.sent.filter((request) => request.type === 'snooze.set')).toHaveLength(1);
    });

    test('a machine from before keeps them in this client, as always', async () => {
        transport.older = true;
        stop = watchSnoozes('Xk3p', transport);
        transport.open();
        await settle();
        useSnoozes.getState().snooze('Xk3p', 't1', later);
        expect(useSnoozes.getState().onMachine).toEqual({});
        expect(storedSnoozes()).toEqual({ 'Xk3p:t1': later });
    });

    test('only a snooze this client keeps ends here when its node stops waiting', async () => {
        stop = watchSnoozes('Xk3p', transport);
        transport.open();
        await settle();
        useSnoozes.getState().snooze('Xk3p', 't1', later);
        useSnoozes.getState().snooze('local', 't1', later);
        useSnoozes.getState().observe(
            new Map([
                ['Xk3p:t1', true],
                ['local:t1', true]
            ])
        );
        useSnoozes.getState().observe(
            new Map([
                ['Xk3p:t1', false],
                ['local:t1', false]
            ])
        );
        expect(useSnoozes.getState().byKey).toEqual({ 'Xk3p:t1': later });
    });
});
