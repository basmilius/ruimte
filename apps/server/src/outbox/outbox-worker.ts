import { errorText } from '../error-text.ts';
import type { OutboxEntry, OutboxStore } from './outbox.ts';

/* How long a failed entry waits before each next attempt; one more failure than there are delays parks it. */
export const RETRY_DELAYS_MS: readonly number[] = [1_000, 5_000, 30_000];

export interface OutboxClock {
    now(): number;
    setTimeout(run: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}

export const systemClock: OutboxClock = {
    now: () => Date.now(),
    setTimeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

export type OutboxHandlers = {
    [K in OutboxEntry['kind']]: (entry: Extract<OutboxEntry, { kind: K }>) => Promise<void>;
};

export interface OutboxWorkerOptions {
    store: OutboxStore;
    handlers: OutboxHandlers;
    clock?: OutboxClock;
    /* An entry that failed every attempt and is given up on; the work it stood for is not done. */
    onParked?: (entry: OutboxEntry, error: unknown) => void;
}

/*
 * Works the outbox off, oldest first and one entry at a time per target, so two pieces of work
 * about one node never overlap while nodes beside it do not wait on each other. A handler is
 * idempotent, since a restart between the work and the removal of its file runs it again.
 */
export class OutboxWorker {
    private readonly store: OutboxStore;
    private readonly handlers: OutboxHandlers;
    private readonly clock: OutboxClock;
    private readonly onParked: (entry: OutboxEntry, error: unknown) => void;
    private readonly running = new Set<string>();
    private timer: unknown = null;
    private started = false;
    private waiters: Array<() => void> = [];

    constructor(options: OutboxWorkerOptions) {
        this.store = options.store;
        this.handlers = options.handlers;
        this.clock = options.clock ?? systemClock;
        this.onParked = options.onParked ?? ((entry, error) => console.error(`Gave up on ${entry.kind} for ${entry.target}:`, errorText(error)));
    }

    start(): void {
        this.started = true;
        this.drain();
    }

    stop(): void {
        this.started = false;
        if (this.timer !== null) {
            this.clock.clearTimeout(this.timer);
            this.timer = null;
        }
    }

    /* Owes a piece of work and starts on it; resolves once the entry is on disk, not once it is done. */
    async enqueue(projectId: string, target: string, work: Parameters<OutboxStore['put']>[2]): Promise<void> {
        await this.store.put(projectId, target, work, this.clock.now());
        this.drain();
    }

    /* Resolves once nothing is running and nothing is due; an entry waiting out a retry does not count. */
    settled(): Promise<void> {
        if (this.isSettled()) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.waiters.push(resolve);
        });
    }

    private drain(): void {
        if (!this.started) {
            return;
        }
        const now = this.clock.now();
        const busy = new Set(this.running);
        let nextDue: number | null = null;
        for (const entry of this.store.list()) {
            if (busy.has(entry.target)) {
                continue;
            }
            // Oldest first per target: a younger entry never overtakes one that waits out a retry.
            busy.add(entry.target);
            if (entry.notBefore > now) {
                nextDue = nextDue === null ? entry.notBefore : Math.min(nextDue, entry.notBefore);
                continue;
            }
            void this.run(entry);
        }
        this.schedule(nextDue, now);
        this.notifySettled();
    }

    private async run(entry: OutboxEntry): Promise<void> {
        this.running.add(entry.target);
        try {
            await (this.handlers[entry.kind] as (entry: OutboxEntry) => Promise<void>)(entry);
            await this.store.remove(entry.id);
        } catch (e) {
            await this.failed(entry, e).catch((error: unknown) => console.error(`The outbox could not record a failed ${entry.kind}:`, errorText(error)));
        } finally {
            this.running.delete(entry.target);
            this.drain();
        }
    }

    private async failed(entry: OutboxEntry, error: unknown): Promise<void> {
        const delay = RETRY_DELAYS_MS[entry.attempts];
        if (delay === undefined) {
            await this.store.remove(entry.id);
            this.onParked(entry, error);
            return;
        }
        await this.store.update({ ...entry, attempts: entry.attempts + 1, notBefore: this.clock.now() + delay });
    }

    private schedule(nextDue: number | null, now: number): void {
        if (this.timer !== null) {
            this.clock.clearTimeout(this.timer);
            this.timer = null;
        }
        if (nextDue !== null) {
            this.timer = this.clock.setTimeout(
                () => {
                    this.timer = null;
                    this.drain();
                },
                Math.max(0, nextDue - now)
            );
        }
    }

    private isSettled(): boolean {
        const now = this.clock.now();
        return this.running.size === 0 && !this.store.list().some((entry) => entry.notBefore <= now);
    }

    private notifySettled(): void {
        if (!this.isSettled()) {
            return;
        }
        const waiting = this.waiters;
        this.waiters = [];
        for (const resolve of waiting) {
            resolve();
        }
    }
}
