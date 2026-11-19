import { HANG_THRESHOLD_MS, HEARTBEAT_MS } from './loop-watch.ts';

/* A sample every 100 ms catches every stall of 300 ms and more, and most from 200 ms, at ten cheap timer callbacks a second. */
export const SAMPLE_MS = 100;

/* Well above the jitter of a sample and a garbage collection, and about where a person starts to feel a delay. */
export const STALL_THRESHOLD_MS = 200;

const STALL_LINES_PER_MINUTE = 5;
const MINUTE_MS = 60_000;
const SUMMARY_MS = 3_600_000;

/*
 * Measures on the main thread how late its own sample timer fires, and hands the worst lag since the last
 * heartbeat to the watchdog worker, which alone can tell a stall from a sleep. `node:perf_hooks`'
 * `monitorEventLoopDelay` would do this natively, but Bun 1.4 reports 2 ms for a loop blocked 300 ms.
 */
export class LagMeter {
    private lastSample: number;
    private lastBeat: number;
    private worstMs = 0;

    constructor(now: number) {
        this.lastSample = now;
        this.lastBeat = now;
    }

    /* The worst lag since the last heartbeat once one is due, so the heartbeat that carries it goes out with it. */
    sample(now: number): number | null {
        // A timer that catches up on missed ticks fires early, which is no negative lag.
        this.worstMs = Math.max(this.worstMs, now - this.lastSample - SAMPLE_MS);
        this.lastSample = now;

        if (now - this.lastBeat < HEARTBEAT_MS) {
            return null;
        }

        const worstMs = this.worstMs;
        this.lastBeat = now;
        this.worstMs = 0;

        return worstMs;
    }
}

/*
 * Turns the worst lag of each heartbeat into log lines in the watchdog worker: one per stall, at most five a
 * minute, and once an hour a summary when that hour had a stall. Its p99 is of the worst lag of each heartbeat,
 * about one a second. A block of five seconds counts as a stall but keeps its own lines.
 */
export class StallLog {
    // One bucket per millisecond up to a hang, allocated once, so a percentile costs nothing per heartbeat.
    private readonly lagCounts = new Uint32Array(HANG_THRESHOLD_MS + 1);
    private beats = 0;
    private stalls = 0;
    private unlogged = 0;
    private maxLagMs = 0;
    private hourStart: number;
    private minuteStart: number;
    private linesThisMinute = 0;

    constructor(now: number) {
        this.hourStart = now;
        this.minuteStart = now;
    }

    /* `paused` says the process was suspended within this heartbeat, so its lag is a sleep and counts for nothing. */
    beat(now: number, lagMs: number, paused: boolean, lastActivity: string | null): string | null {
        if (paused) {
            return null;
        }

        const roundedMs = Math.round(lagMs);
        this.lagCounts[Math.min(roundedMs, HANG_THRESHOLD_MS)]++;
        this.beats++;
        this.maxLagMs = Math.max(this.maxLagMs, roundedMs);

        if (roundedMs < STALL_THRESHOLD_MS) {
            return null;
        }

        this.stalls++;

        if (roundedMs >= HANG_THRESHOLD_MS) {
            return null;
        }

        if (now - this.minuteStart >= MINUTE_MS) {
            this.minuteStart = now;
            this.linesThisMinute = 0;
        }

        if (this.linesThisMinute >= STALL_LINES_PER_MINUTE) {
            this.unlogged++;

            return null;
        }

        this.linesThisMinute++;

        return lastActivity === null ? `The event loop stalled for ${roundedMs} ms` : `The event loop stalled for ${roundedMs} ms, after ${lastActivity} began`;
    }

    check(now: number): string | null {
        if (now - this.hourStart < SUMMARY_MS) {
            return null;
        }

        const line = this.stalls === 0 ? null : this.summary();
        this.hourStart = now;
        this.lagCounts.fill(0);
        this.beats = 0;
        this.stalls = 0;
        this.unlogged = 0;
        this.maxLagMs = 0;

        return line;
    }

    private summary(): string {
        const times = this.stalls === 1 ? 'once' : `${this.stalls} times`;
        const unlogged = this.unlogged === 0 ? '' : `, ${this.unlogged} of them not logged`;

        return `The event loop stalled ${times} in the last hour${unlogged}, with a p99 lag of ${this.p99()} ms and a max of ${this.maxLagMs} ms`;
    }

    private p99(): number {
        const rank = Math.ceil(this.beats * 0.99);
        let seen = 0;

        for (let lagMs = 0; lagMs < this.lagCounts.length; lagMs++) {
            seen += this.lagCounts[lagMs] ?? 0;

            if (seen >= rank) {
                // The last bucket holds every hang, of whatever length; the worst of them bounds it.
                return lagMs === HANG_THRESHOLD_MS ? this.maxLagMs : lagMs;
            }
        }

        return this.maxLagMs;
    }
}
