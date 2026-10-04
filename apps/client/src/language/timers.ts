/* The clock a language feature waits on, which a test replaces so it never waits on a real one. */
export interface Timers {
    set(callback: () => void, delay: number): unknown;
    clear(handle: unknown): void;
}

export const realTimers: Timers = {
    set: (callback, delay) => setTimeout(callback, delay),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

/* Runs what was scheduled when a test says how much time has passed. */
export class ManualTimers implements Timers {
    private now = 0;
    private next = 1;
    private readonly pending = new Map<number, { at: number; callback: () => void }>();

    set(callback: () => void, delay: number): unknown {
        const id = this.next++;
        this.pending.set(id, { at: this.now + delay, callback });
        return id;
    }

    clear(handle: unknown): void {
        this.pending.delete(handle as number);
    }

    advance(milliseconds: number): void {
        const until = this.now + milliseconds;
        for (;;) {
            const due = [...this.pending].filter(([, entry]) => entry.at <= until).sort((left, right) => left[1].at - right[1].at)[0];
            if (due === undefined) {
                break;
            }
            this.now = due[1].at;
            this.pending.delete(due[0]);
            due[1].callback();
        }
        this.now = until;
    }

    get size(): number {
        return this.pending.size;
    }
}
