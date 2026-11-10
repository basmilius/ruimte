import { errorText } from '../error-text.ts';
import { realTimers, type Timers } from '../timers.ts';

export interface Reclaimed {
    files: number;
    bytes: number;
}

/*
 * One kind of disposable file, swept by the rule of the code that writes it. A sweep bounds its own
 * work and stops between two files once `signal` aborts, which the daemon does at shutdown.
 */
export interface Sweeper {
    readonly name: string;
    sweep(now: number, signal: AbortSignal): Promise<Reclaimed>;
}

export interface MaintenanceOptions {
    sweepers: readonly Sweeper[];
    /* Read before every pass; a busy machine skips that pass and waits for the next. */
    idle(): boolean;
    now(): number;
    log(line: string): void;
    timers?: Timers;
    intervalMs?: number;
}

const INTERVAL_MS = 60 * 60 * 1000;

/*
 * Takes away disposable files past their age once at the start and then every hour while the machine
 * is idle, so one leaves without waiting for the next capture or restart. The next pass is set only
 * once the last one ended, so two never overlap.
 */
export class Maintenance {
    private readonly options: MaintenanceOptions;
    private readonly timers: Timers;
    private readonly abort = new AbortController();
    private cancelNext: (() => void) | null = null;
    private running: Promise<void> | null = null;
    private started = false;

    constructor(options: MaintenanceOptions) {
        this.options = options;
        this.timers = options.timers ?? realTimers;
    }

    start(): void {
        if (this.started || this.abort.signal.aborted) {
            return;
        }

        this.started = true;
        this.run();
    }

    async stop(): Promise<void> {
        this.abort.abort();
        this.cancelNext?.();
        this.cancelNext = null;
        await this.running;
    }

    private run(): void {
        const pass = this.pass().finally(() => {
            if (this.running === pass) {
                this.running = null;
            }

            this.schedule();
        });

        this.running = pass;
    }

    private schedule(): void {
        if (this.abort.signal.aborted) {
            return;
        }

        this.cancelNext = this.timers.set(() => {
            this.cancelNext = null;
            this.run();
        }, this.options.intervalMs ?? INTERVAL_MS);
    }

    private async pass(): Promise<void> {
        if (!this.idleNow()) {
            return;
        }

        for (const sweeper of this.options.sweepers) {
            if (this.abort.signal.aborted) {
                return;
            }

            try {
                const { files, bytes } = await sweeper.sweep(this.options.now(), this.abort.signal);

                if (files > 0) {
                    this.options.log(`Maintenance took away ${files} expired ${sweeper.name} (${bytes} bytes)`);
                }
            } catch (e) {
                this.options.log(`Sweeping ${sweeper.name} failed: ${errorText(e)}`);
            }
        }
    }

    private idleNow(): boolean {
        try {
            return this.options.idle();
        } catch {
            return false;
        }
    }
}
