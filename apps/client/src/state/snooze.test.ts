import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { isSnoozed, MAX_TICK_MS, snoozeOf, nextWake, observeWaiting, snoozeUntil, startSnoozeClock, useSnoozes, withoutExpired } from './snooze';

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
