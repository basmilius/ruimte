import { afterEach, beforeEach, describe, expect, jest, setSystemTime, test } from 'bun:test';
import type { EventMap, EventType, RequestMap, RequestType, Snooze } from '@ruimte/contracts';
import type { Transport, TransportStatus } from '@/transport/transport';
import { isSnoozed, MAX_TICK_MS, snoozeOf, nextWake, snoozeUntil, startSnoozeClock, useSnoozes, watchSnoozes, withoutExpired } from './snooze';

function at(year: number, month: number, day: number, hour: number, minute = 0): number {
    return new Date(year, month - 1, day, hour, minute).getTime();
}

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

describe('the snooze clock', () => {
    let now = 0;
    let stop: () => void = () => {};

    beforeEach(() => {
        jest.useFakeTimers();
        now = 0;
        useSnoozes.setState({ byKey: {} });
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
    readonly sent: { type: RequestType; payload: unknown }[] = [];
    private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
    private readonly statusHandlers = new Set<(status: TransportStatus) => void>();

    request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
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

function settle(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

describe('snoozes a machine keeps', () => {
    let transport: FakeTransport;
    let stop: () => void = () => {};
    const now = at(2026, 9, 24, 14, 5);
    const later = now + 3_600_000;

    beforeEach(() => {
        setSystemTime(now);
        transport = new FakeTransport();
        useSnoozes.setState({ byKey: {} });
    });

    afterEach(() => {
        stop();
        setSystemTime();
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

    test('a snooze set or ended here is sent to the machine', async () => {
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
    });

    test('a snooze set while the link is down is held here and goes over once it is back', async () => {
        transport.held = [{ projectId: 'p1', nodeId: 't3', until: later }];
        stop = watchSnoozes('Xk3p', transport);
        transport.open();
        await settle();
        transport.status = 'closed';
        useSnoozes.getState().snooze('Xk3p', 't1', later);
        // One that ran out before the link came back goes nowhere.
        useSnoozes.getState().snooze('Xk3p', 't2', now - 1);
        useSnoozes.getState().unsnooze('Xk3p', 't3');
        expect(transport.sent.filter((request) => request.type !== 'snooze.list')).toEqual([]);
        transport.open();
        await settle();
        expect(transport.sent.filter((request) => request.type !== 'snooze.list')).toEqual([
            { type: 'snooze.set', payload: { nodeId: 't1', until: later } },
            { type: 'snooze.clear', payload: { nodeId: 't3' } }
        ]);
    });
});
