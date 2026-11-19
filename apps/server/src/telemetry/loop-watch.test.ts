import { describe, expect, test } from 'bun:test';
import { LoopWatch } from './loop-watch.ts';

/* Checks once a second from `from` to `to`, as the worker's interval does, and returns every verdict. */
function tick(watch: LoopWatch, from: number, to: number): ReturnType<LoopWatch['check']>[] {
    const verdicts: ReturnType<LoopWatch['check']>[] = [];
    for (let at = from; at <= to; at += 1000) {
        verdicts.push(watch.check(at));
    }
    return verdicts.filter((verdict) => verdict !== null);
}

describe('LoopWatch', () => {
    test('says nothing while the heartbeats come', () => {
        const watch = new LoopWatch(0, 5000, 1000);
        expect(watch.check(1000)).toBeNull();
        expect(watch.beat(1000)).toBeNull();
        expect(tick(watch, 2000, 5000)).toEqual([]);
    });

    test('reports a block once, and its end once', () => {
        const watch = new LoopWatch(0, 5000, 1000);
        expect(tick(watch, 1000, 9000)).toEqual([{ state: 'blocked', sinceMs: 5000 }]);
        expect(watch.beat(12_000)).toEqual({ state: 'recovered', blockedMs: 12_000 });
        expect(watch.beat(13_000)).toBeNull();
    });

    test('reports a second block after the loop answered again', () => {
        const watch = new LoopWatch(0, 5000, 1000);
        tick(watch, 1000, 6000);
        watch.beat(7000);
        expect(tick(watch, 7000, 11_000)).toEqual([]);
        expect(watch.check(12_000)).toEqual({ state: 'blocked', sinceMs: 5000 });
    });

    test('a sleep that suspended the worker too is no block, and the count starts over after it', () => {
        const watch = new LoopWatch(0, 5000, 1000);
        watch.check(1000);
        const woke = 1000 + 8 * 3_600_000;
        expect(watch.check(woke)).toBeNull();
        expect(tick(watch, woke + 1000, woke + 4000)).toEqual([]);
        expect(watch.check(woke + 5000)).toEqual({ state: 'blocked', sinceMs: 5000 });
    });

    test('a heartbeat after the sleep keeps the loop counted as answering', () => {
        const watch = new LoopWatch(0, 5000, 1000);
        watch.check(1000);
        const woke = 1000 + 8 * 3_600_000;
        expect(watch.beat(woke)).toBeNull();
        expect(watch.check(woke + 500)).toBeNull();
        expect(tick(watch, woke + 1500, woke + 4500)).toEqual([]);
    });

    test('knows a sleep since a heartbeat, whether a heartbeat or a check saw it first', () => {
        const byBeat = new LoopWatch(0, 5000, 1000);
        byBeat.check(1000);
        byBeat.beat(1000);

        expect(byBeat.pausedSince(1000)).toBe(false);

        byBeat.beat(60_000);

        expect(byBeat.pausedSince(1000)).toBe(true);
        expect(byBeat.pausedSince(60_001)).toBe(false);

        const byCheck = new LoopWatch(0, 5000, 1000);
        byCheck.check(1000);
        byCheck.check(60_000);

        expect(byCheck.pausedSince(1000)).toBe(true);
    });

    test('a main thread that blocks while the worker ticks is no sleep', () => {
        const watch = new LoopWatch(0, 5000, 1000);
        tick(watch, 1000, 3000);
        watch.beat(3000);

        expect(watch.pausedSince(0)).toBe(false);
    });
});
