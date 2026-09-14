import type { ChatEvent } from '@ruimte/contracts';

/* The same rhythm as terminal output: a frame at 60 Hz. */
export const DELTA_TICK_MS = 16;

/*
 * Holds the deltas of one chat back for a frame and sends the run on one item as a single delta. A
 * CLI writes tens of deltas a second and every one was a frame to every client and a state update
 * there, while the reveal on the client only moves once per frame anyway. Any other event sends
 * what is held first, so the order a client sees is the order the thread changed in.
 */
export class DeltaCoalescer {
    private pending: { itemId: string; text: string } | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private readonly send: (event: ChatEvent) => void;
    private readonly tickMs: number;

    constructor(send: (event: ChatEvent) => void, tickMs: number = DELTA_TICK_MS) {
        this.send = send;
        this.tickMs = tickMs;
    }

    push(event: ChatEvent): void {
        if (event.type !== 'delta') {
            this.flush();
            this.send(event);
            return;
        }
        if (this.pending !== null && this.pending.itemId === event.itemId) {
            this.pending.text += event.text;
            return;
        }
        this.flush();
        this.pending = { itemId: event.itemId, text: event.text };
        this.timer = setTimeout(() => this.flush(), this.tickMs);
        // A frame of text waiting must never be the reason the process stays up.
        this.timer.unref?.();
    }

    /* Sends what is held now, before a client attaches or detaches or the tick runs out. */
    flush(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        const pending = this.pending;
        if (pending === null) {
            return;
        }
        this.pending = null;
        this.send({ type: 'delta', itemId: pending.itemId, text: pending.text });
    }

    /* Drops what is held without sending it, for a chat that is gone. */
    dispose(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.pending = null;
    }
}
