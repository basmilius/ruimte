import { systemClock, type Clock } from '@adecore/agents/coordination';
import { cancellableTimeout } from '@adecore/utils/async';

/* A timer a test can replace, with the callback first. */
export interface Timers {
    set(run: () => void, ms: number): () => void;
}

export const realTimers: Timers = {
    set: (run, ms) => cancellableTimeout(ms, run)
};

/* A timer asleep with the machine runs late by as long as it slept, so the wall clock is read again at least this often. */
export const MAX_WAIT_MS = 60_000;

/*
 * The outbox's clock with no wait longer than a minute: a routine due while the lid was closed runs
 * within a minute of waking instead of the length of the sleep later. A wait that ends early only
 * makes the worker look again and find nothing due yet.
 */
export function wakefulClock(clock: Clock = systemClock): Clock {
    return {
        now: () => clock.now(),
        setTimeout: (run, ms) => clock.setTimeout(run, Math.min(ms, MAX_WAIT_MS)),
        clearTimeout: (handle) => clock.clearTimeout(handle)
    };
}
