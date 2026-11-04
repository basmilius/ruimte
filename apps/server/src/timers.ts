import { cancellableTimeout } from '@adecore/utils/async';

/* A timer a test can replace, with the callback first. */
export interface Timers {
    set(run: () => void, ms: number): () => void;
}

export const realTimers: Timers = {
    set: (run, ms) => cancellableTimeout(ms, run)
};
