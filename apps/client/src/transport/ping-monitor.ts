/* How often a connected client measures the round trip to its daemon. */
export const PING_INTERVAL_MS = 10_000;

/* Above this a round trip is slow enough for the dot to say so. */
export const SLOW_PING_MS = 250;

export interface PingMonitorOptions {
    /* One round trip to the daemon; anything it rejects with counts as a failed measurement. */
    send(): Promise<unknown>;
    report(latency: number | null): void;
    /* A round trip went unanswered for `timeoutMs`: the link may look open and be dead, which only a new one tells apart. */
    stalled?(): void;
    now?(): number;
    intervalMs?: number;
    /* Two intervals by default, so one slow reply is not yet a dead link. */
    timeoutMs?: number;
}

/* Times `server.ping` on a timer while the caller keeps it running. It knows nothing about the
   socket. The transport is one injected call, which is what makes the bookkeeping testable. */
export class PingMonitor {
    private readonly options: PingMonitorOptions;
    private timer: ReturnType<typeof setInterval> | null = null;
    private inFlight = false;
    private generation = 0;

    constructor(options: PingMonitorOptions) {
        this.options = options;
    }

    get running(): boolean {
        return this.timer !== null;
    }

    /* Measures right away, so the first value is there before the first interval passes. */
    start(): void {
        if (this.timer) {
            return;
        }
        this.timer = setInterval(() => {
            void this.measure();
        }, this.options.intervalMs ?? PING_INTERVAL_MS);
        void this.measure();
    }

    /* Drops the last value too. A round trip measured before the socket dropped says nothing about the next one. */
    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.generation += 1;
        this.options.report(null);
    }

    async measure(): Promise<void> {
        if (this.inFlight) {
            return;
        }
        this.inFlight = true;
        const generation = this.generation;
        const clock = this.options.now ?? (() => performance.now());
        const started = clock();
        let timedOut = false;
        const timeout = setTimeout(
            () => {
                timedOut = true;
                // The next measurement may go out, since this one is never coming back.
                this.inFlight = false;
                if (generation === this.generation) {
                    this.options.report(null);
                    this.options.stalled?.();
                }
            },
            this.options.timeoutMs ?? 2 * (this.options.intervalMs ?? PING_INTERVAL_MS)
        );
        // A reply that lands after a stop or after the timeout measured a connection that is gone.
        const current = (): boolean => !timedOut && generation === this.generation;
        try {
            await this.options.send();
            if (current()) {
                this.options.report(clock() - started);
            }
        } catch {
            if (current()) {
                this.options.report(null);
            }
        } finally {
            clearTimeout(timeout);
            if (!timedOut) {
                this.inFlight = false;
            }
        }
    }
}
