/* How often a connected client measures the round trip to its daemon. */
export const PING_INTERVAL_MS = 10_000;

/* Above this a round trip is slow enough for the dot to say so. */
export const SLOW_PING_MS = 250;

export interface PingMonitorOptions {
    /* One round trip to the daemon; anything it rejects with counts as a failed measurement. */
    send(): Promise<unknown>;
    report(latency: number | null): void;
    now?(): number;
    intervalMs?: number;
}

/* Times `server.ping` on a timer while the caller keeps it running. It knows nothing about the
   socket: the transport is one injected call, which is what makes the bookkeeping testable. */
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

    /* Drops the last value too: a round trip measured before the socket dropped says nothing about the next one. */
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
        try {
            await this.options.send();
            // A reply that lands after a stop measured a connection that is gone.
            if (generation === this.generation) {
                this.options.report(clock() - started);
            }
        } catch {
            if (generation === this.generation) {
                this.options.report(null);
            }
        } finally {
            this.inFlight = false;
        }
    }
}
