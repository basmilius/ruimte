import { describe, expect, test } from 'bun:test';
import { LagMeter, StallLog } from './loop-lag.ts';

const HOUR_MS = 3_600_000;

/* Feeds a quiet heartbeat every second from `from` up to but not including `to`. */
function quiet(log: StallLog, from: number, to: number): void {
    for (let at = from; at < to; at += 1000) {
        log.beat(at, 2, false, null);
    }
}

describe('LagMeter', () => {
    test('hands the worst lag since the last heartbeat to the next one', () => {
        const meter = new LagMeter(0);
        const beats = [100, 200, 650, 750, 850, 950, 1050].map((at) => meter.sample(at));

        expect(beats).toEqual([null, null, null, null, null, null, 350]);
        expect(meter.sample(1150)).toBeNull();
    });

    test('counts a timer that catches up early as no lag', () => {
        const meter = new LagMeter(0);
        meter.sample(900);

        expect(meter.sample(1000)).toBe(800);
        expect(meter.sample(1001)).toBeNull();
        expect([1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000].map((at) => meter.sample(at)).at(-1)).toBe(0);
    });
});

describe('StallLog', () => {
    test('logs a stall with what began before it, and nothing under the threshold', () => {
        const log = new StallLog(0);

        expect(log.beat(1000, 199, false, 'chat.attach')).toBeNull();
        expect(log.beat(2000, 340, false, 'chat.attach')).toBe('The event loop stalled for 340 ms, after chat.attach began');
        expect(log.beat(3000, 250.4, false, null)).toBe('The event loop stalled for 250 ms');
    });

    test('a heartbeat with a sleep in it is no stall', () => {
        const log = new StallLog(0);

        expect(log.beat(1000, 8 * HOUR_MS, true, null)).toBeNull();
        expect(log.check(HOUR_MS)).toBeNull();
    });

    test('a block of five seconds leaves its lines to the hang watch but counts in the summary', () => {
        const log = new StallLog(0);

        expect(log.beat(7000, 6000, false, null)).toBeNull();
        expect(log.check(HOUR_MS)).toBe('The event loop stalled once in the last hour, with a p99 lag of 6000 ms and a max of 6000 ms');
    });

    test('logs at most five stalls a minute and counts the rest', () => {
        const log = new StallLog(0);
        const lines = [1, 2, 3, 4, 5, 6, 7].map((second) => log.beat(second * 1000, 300, false, null));

        expect(lines.filter((line) => line !== null)).toHaveLength(5);
        expect(log.beat(61_000, 300, false, null)).toBe('The event loop stalled for 300 ms');

        quiet(log, 62_000, HOUR_MS);

        expect(log.check(HOUR_MS)).toBe('The event loop stalled 8 times in the last hour, 2 of them not logged, with a p99 lag of 2 ms and a max of 300 ms');
    });

    test('says nothing on a quiet hour, and starts each hour over', () => {
        const log = new StallLog(0);
        quiet(log, 1000, HOUR_MS);

        expect(log.check(HOUR_MS - 1)).toBeNull();
        expect(log.check(HOUR_MS)).toBeNull();

        log.beat(HOUR_MS + 1000, 900, false, null);
        quiet(log, HOUR_MS + 2000, HOUR_MS + 51_000);

        expect(log.check(2 * HOUR_MS)).toBe('The event loop stalled once in the last hour, with a p99 lag of 900 ms and a max of 900 ms');
        expect(log.check(3 * HOUR_MS)).toBeNull();
    });
});
