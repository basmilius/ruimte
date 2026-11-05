import { describe, expect, test } from 'bun:test';
import type { FrameClock } from '@/surface/canvas/pan-batch';
import { oncePerFrame } from './once-per-frame';

/* Frames and the end of a task only come when the test says so. */
function fakes() {
    let frames = new Map<number, () => void>();
    let next = 1;
    let tasks: Array<() => void> = [];
    const clock: FrameClock = {
        request: (callback) => {
            frames.set(next, callback);
            return next++;
        },
        cancel: (handle) => {
            frames.delete(handle);
        }
    };
    return {
        clock,
        microtask: (callback: () => void): void => {
            tasks.push(callback);
        },
        endTask: (): void => {
            const due = tasks;
            tasks = [];
            due.forEach((task) => task());
        },
        frame: (): void => {
            const due = frames;
            frames = new Map();
            due.forEach((callback) => callback());
        },
        pendingFrames: (): number => frames.size
    };
}

describe('once per frame', () => {
    test('requests in one task run once, at the end of that task', () => {
        const time = fakes();
        let runs = 0;
        const frame = oncePerFrame(() => runs++, time.clock, time.microtask);
        frame.request();
        frame.request();
        expect(runs).toBe(0);
        time.endTask();
        expect(runs).toBe(1);
    });

    test('a request later in the same frame waits for the next one, and many of them run once', () => {
        const time = fakes();
        let runs = 0;
        const frame = oncePerFrame(() => runs++, time.clock, time.microtask);
        frame.request();
        time.endTask();
        frame.request();
        time.endTask();
        frame.request();
        time.endTask();
        expect(runs).toBe(1);
        time.frame();
        expect(runs).toBe(2);
    });

    test('the first request of a new frame runs in that frame again', () => {
        const time = fakes();
        let runs = 0;
        const frame = oncePerFrame(() => runs++, time.clock, time.microtask);
        frame.request();
        time.endTask();
        time.frame();
        frame.request();
        time.endTask();
        expect(runs).toBe(2);
    });

    test('nothing runs or waits after it is disposed', () => {
        const time = fakes();
        let runs = 0;
        const frame = oncePerFrame(() => runs++, time.clock, time.microtask);
        frame.request();
        time.endTask();
        frame.request();
        frame.dispose();
        time.frame();
        frame.request();
        time.endTask();
        expect(runs).toBe(1);
        expect(time.pendingFrames()).toBe(0);
    });
});
