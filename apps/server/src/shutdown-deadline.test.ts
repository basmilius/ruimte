import { afterAll, expect, spyOn, test } from 'bun:test';
import { armShutdownDeadline, LAST_STEP_LIMIT_MS, SHUTDOWN_LIMIT_MS } from './shutdown-deadline.ts';
import type { Timers } from './timers.ts';

const quiet = spyOn(console, 'error').mockImplementation(() => undefined);

afterAll(() => {
    quiet.mockRestore();
});

function fakeTimers(): Timers & { fire(): void; armedFor: number[] } {
    const pending: (() => void)[] = [];
    const armedFor: number[] = [];

    return {
        armedFor,
        set(run, ms) {
            pending.push(run);
            armedFor.push(ms);
            return () => {
                const at = pending.indexOf(run);
                if (at !== -1) {
                    pending.splice(at, 1);
                }
            };
        },
        fire() {
            pending.splice(0).forEach((run) => run());
        }
    };
}

const never = (): Promise<void> => new Promise(() => undefined);

test('a shutdown past its limit still ends the terminals and exits with a failure', async () => {
    const timers = fakeTimers();
    let ended = 0;

    const exited = new Promise<number>((resolve) => {
        armShutdownDeadline(
            resolve,
            async () => {
                ended += 1;
            },
            timers
        );
    });
    timers.fire();

    expect(await exited).toBe(1);
    expect(ended).toBe(1);
    expect(timers.armedFor).toEqual([SHUTDOWN_LIMIT_MS, LAST_STEP_LIMIT_MS]);
});

test('ending the terminals that never settles still exits once its own limit passes', () => {
    const timers = fakeTimers();
    const exits: number[] = [];

    armShutdownDeadline((code) => exits.push(code), never, timers);
    timers.fire();

    expect(exits).toEqual([]);

    timers.fire();

    expect(exits).toEqual([1]);
});

test('ending the terminals that fails still exits once', async () => {
    const timers = fakeTimers();
    const exits: number[] = [];

    const exited = new Promise<void>((resolve) => {
        armShutdownDeadline(
            (code) => {
                exits.push(code);
                resolve();
            },
            () => Promise.reject(new Error('taskkill failed')),
            timers
        );
    });
    timers.fire();
    await exited;
    timers.fire();

    expect(exits).toEqual([1]);
});

test('a disarmed deadline never exits', () => {
    const timers = fakeTimers();
    const exits: number[] = [];

    armShutdownDeadline((code) => exits.push(code), never, timers)();
    timers.fire();

    expect(exits).toEqual([]);
});
