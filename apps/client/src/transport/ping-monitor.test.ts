import { describe, expect, jest, test } from 'bun:test';
import { PingMonitor } from './ping-monitor';

// Fake timers leave setImmediate alone, so this drains every pending promise without letting a timer run.
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const deferred = <T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

describe('PingMonitor', () => {
    test('reports the round trip of one measurement', async () => {
        const reported: (number | null)[] = [];
        let clock = 1000;
        const monitor = new PingMonitor({
            send: async () => {
                clock += 12;
            },
            report: (latency) => reported.push(latency),
            now: () => clock
        });

        await monitor.measure();

        expect(reported).toEqual([12]);
    });

    test('reports nothing measurable when the request fails', async () => {
        const reported: (number | null)[] = [];
        const monitor = new PingMonitor({
            send: () => Promise.reject(new Error('not connected')),
            report: (latency) => reported.push(latency),
            now: () => 0
        });

        await monitor.measure();

        expect(reported).toEqual([null]);
    });

    test('keeps one measurement in flight at a time', async () => {
        const pending = deferred<void>();
        let sends = 0;
        const monitor = new PingMonitor({
            send: () => {
                sends += 1;
                return pending.promise;
            },
            report: () => undefined,
            now: () => 0
        });

        const first = monitor.measure();
        await monitor.measure();
        pending.resolve();
        await first;

        expect(sends).toBe(1);
    });

    test('drops a reply that lands after a stop', async () => {
        const pending = deferred<void>();
        const reported: (number | null)[] = [];
        const monitor = new PingMonitor({
            send: () => pending.promise,
            report: (latency) => reported.push(latency),
            now: () => 0
        });

        const measuring = monitor.measure();
        monitor.stop();
        pending.resolve();
        await measuring;

        expect(reported).toEqual([null]);
    });

    test('polls while it runs and stops on stop', async () => {
        jest.useFakeTimers();
        try {
            const reported: (number | null)[] = [];
            let clock = 0;
            const monitor = new PingMonitor({
                send: async () => {
                    clock += 1;
                },
                report: (latency) => reported.push(latency),
                now: () => clock,
                intervalMs: 5
            });

            monitor.start();
            expect(monitor.running).toBe(true);
            await flush();
            expect(reported).toEqual([1]);
            // One interval at a time, so each measurement has settled before the next one fires.
            for (let i = 0; i < 3; i++) {
                jest.advanceTimersByTime(5);
                await flush();
            }
            expect(reported).toEqual([1, 1, 1, 1]);

            monitor.stop();
            jest.advanceTimersByTime(15);
            await flush();
            expect(monitor.running).toBe(false);
            expect(reported).toEqual([1, 1, 1, 1, null]);
        } finally {
            jest.useRealTimers();
        }
    });
});
