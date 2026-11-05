import { afterAll, expect, spyOn, test } from 'bun:test';
import { armShutdownDeadline, SHUTDOWN_LIMIT_MS } from './shutdown-deadline.ts';
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
                pending.splice(pending.indexOf(run), 1);
            };
        },
        fire() {
            pending.splice(0).forEach((run) => run());
        }
    };
}

test('a shutdown still exits once the limit passes, whatever step it waits on', () => {
    const timers = fakeTimers();
    const exits: number[] = [];

    armShutdownDeadline((code) => exits.push(code), timers);
    timers.fire();

    expect(timers.armedFor).toEqual([SHUTDOWN_LIMIT_MS]);
    expect(exits).toEqual([0]);
});

test('a disarmed deadline never exits', () => {
    const timers = fakeTimers();
    const exits: number[] = [];

    armShutdownDeadline((code) => exits.push(code), timers)();
    timers.fire();

    expect(exits).toEqual([]);
});
