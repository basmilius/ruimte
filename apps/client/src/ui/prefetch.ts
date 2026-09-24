export type Loader = () => Promise<unknown>;

/* Calls `run` once the main thread has nothing better to do. */
export type WhenIdle = (run: () => void) => void;

/*
 * Loads lazy modules ahead of their first opening, one per idle moment and never two at once, so
 * the first open resolves from the module cache. A loader registered while everything is on
 * joins the end, which is how a lazy surface inside another lazy one gets its turn.
 */
export class Prefetcher {
    private readonly registered: Loader[] = [];
    private readonly queued = new Set<Loader>();
    private readonly queue: Loader[] = [];
    private everythingOn = false;
    private running: Promise<void> | null = null;
    private loading = false;
    private readonly whenIdle: WhenIdle;
    /* Asked on every start, since a person can turn data saving on while the page runs. */
    private readonly allowed: () => boolean;

    constructor(whenIdle: WhenIdle, allowed: () => boolean = () => true) {
        this.whenIdle = whenIdle;
        this.allowed = allowed;
    }

    /* True while a prefetch waits on its chunk, so a failure it causes is not taken for a person's. */
    get busy(): boolean {
        return this.loading;
    }

    register(load: Loader): void {
        this.registered.push(load);
        if (this.everythingOn) {
            this.enqueue(load);
        }
    }

    /* Loads this one module, ahead of whatever is registered. */
    prefetch(load: Loader): Promise<void> {
        if (!this.allowed()) {
            return Promise.resolve();
        }
        this.enqueue(load);
        return this.drain();
    }

    /* Loads every registered module, and every one registered from now on. */
    prefetchEverything(): Promise<void> {
        if (!this.allowed()) {
            return Promise.resolve();
        }
        this.everythingOn = true;
        for (const load of this.registered) {
            this.enqueue(load);
        }
        return this.drain();
    }

    private enqueue(load: Loader): void {
        if (this.queued.has(load)) {
            return;
        }
        this.queued.add(load);
        this.queue.push(load);
        void this.drain();
    }

    private drain(): Promise<void> {
        // Never on an empty queue: `loadQueue` would clear `running` before it is even set.
        if (this.running === null && this.queue.length > 0) {
            this.running = this.loadQueue();
        }
        return this.running ?? Promise.resolve();
    }

    private async loadQueue(): Promise<void> {
        try {
            for (let load = this.queue.shift(); load; load = this.queue.shift()) {
                await new Promise<void>((resolve) => this.whenIdle(resolve));
                this.loading = true;
                try {
                    await load();
                } catch {
                    // A later open tries again, and `stale-chunks.ts` answers a chunk a deploy removed.
                } finally {
                    this.loading = false;
                }
            }
        } finally {
            this.running = null;
        }
    }
}

/* Safari has no idle callback; the timeout at least lets the frame that asked finish first. */
const FALLBACK_DELAY_MS = 50;
/* A canvas that keeps drawing (a blinking cursor, a stream) may never leave an idle moment, and a prefetch that never runs helps nobody. */
const IDLE_TIMEOUT_MS = 2000;

const whenIdle: WhenIdle = (run) => {
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => run(), { timeout: IDLE_TIMEOUT_MS });
        return;
    }
    setTimeout(run, FALLBACK_DELAY_MS);
};

/* Not in every DOM typing yet, and only Chromium reports it. */
const savesData = (): boolean => (navigator as { connection?: { saveData?: boolean } }).connection?.saveData === true;

export const prefetcher = new Prefetcher(whenIdle, () => !savesData());
