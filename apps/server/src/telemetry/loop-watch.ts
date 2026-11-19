export const HANG_THRESHOLD_MS = 5000;
export const HEARTBEAT_MS = 1000;

type LoopVerdict = { state: 'blocked'; sinceMs: number } | { state: 'recovered'; blockedMs: number } | null;

/*
 * Tells from the heartbeats of the main thread whether its event loop is stuck. Runs in the watchdog
 * worker, which keeps ticking while the main thread does not; a block is reported once, and its end once.
 */
export class LoopWatch {
    private lastBeat: number;
    private lastCheck: number;
    private blocked = false;
    private lastPauseEnd = Number.NEGATIVE_INFINITY;
    private readonly thresholdMs: number;
    private readonly tickMs: number;

    /* `tickMs` is how often the worker checks; a check that comes far later says the worker was suspended too. */
    constructor(now: number, thresholdMs = HANG_THRESHOLD_MS, tickMs = HEARTBEAT_MS) {
        this.lastBeat = now;
        this.lastCheck = now;
        this.thresholdMs = thresholdMs;
        this.tickMs = tickMs;
    }

    beat(now: number): LoopVerdict {
        // After a sleep the first heartbeat can come before the worker's own check does.
        if (this.wasSuspended(now)) {
            this.lastPauseEnd = now;
        }

        const silentMs = now - this.lastBeat;
        this.lastBeat = now;
        if (!this.blocked) {
            return null;
        }
        this.blocked = false;
        return { state: 'recovered', blockedMs: silentMs };
    }

    check(now: number): LoopVerdict {
        const suspended = this.wasSuspended(now);
        this.lastCheck = now;
        // The machine slept, or the whole process was stopped: the main thread missed nothing the worker saw.
        if (suspended) {
            this.lastBeat = now;
            this.lastPauseEnd = now;
            return null;
        }
        const silentMs = now - this.lastBeat;
        if (this.blocked || silentMs < this.thresholdMs) {
            return null;
        }
        this.blocked = true;
        return { state: 'blocked', sinceMs: silentMs };
    }

    /* Whether the worker was suspended at some point after `at`, so a lag the main thread measured since then is no stall. */
    pausedSince(at: number): boolean {
        return this.lastPauseEnd >= at;
    }

    private wasSuspended(now: number): boolean {
        return now - this.lastCheck > 2 * this.tickMs;
    }
}
