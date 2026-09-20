import type { OutboxClock } from './outbox-worker.ts';

/* A clock a test moves by hand. A timer fires only inside `advance`, never on its own. */
export class ManualClock implements OutboxClock {
    private time = 1_000_000;
    private timers: Array<{ at: number; run: () => void; id: number }> = [];
    private nextId = 1;

    now(): number {
        return this.time;
    }

    setTimeout(run: () => void, ms: number): unknown {
        const id = this.nextId++;
        this.timers.push({ at: this.time + ms, run, id });
        return id;
    }

    clearTimeout(handle: unknown): void {
        this.timers = this.timers.filter((timer) => timer.id !== handle);
    }

    advance(ms: number): void {
        this.time += ms;
        const due = this.timers.filter((timer) => timer.at <= this.time);
        this.timers = this.timers.filter((timer) => timer.at > this.time);
        for (const timer of due) {
            timer.run();
        }
    }
}
