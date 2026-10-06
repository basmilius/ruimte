import { StaleResultError } from '@adecore/lsp';
import { realTimers, type Timers } from './timers';

/*
 * Asks again for something a document's text decides, such as its colors or its hints: after a pause
 * in typing, when a server says what it offers changed, and never twice at once. A newer ask aborts the
 * one before it, and an answer for a text that has moved on is dropped, since another ask is on its way.
 */
export class Refresher {
    private timer: unknown;
    private controller: AbortController | null = null;
    private disposed = false;
    private readonly timers: Timers;
    private readonly delay: number;
    private readonly run: (signal: AbortSignal) => Promise<void>;

    constructor(run: (signal: AbortSignal) => Promise<void>, delay: number, timers: Timers = realTimers) {
        this.run = run;
        this.delay = delay;
        this.timers = timers;
    }

    /* After a pause: every call starts the wait again. */
    later(): void {
        this.timers.clear(this.timer);
        this.timer = this.timers.set(() => this.now(), this.delay);
    }

    now(): void {
        if (this.disposed) {
            return;
        }
        this.timers.clear(this.timer);
        this.controller?.abort();
        const controller = new AbortController();
        this.controller = controller;
        this.run(controller.signal).catch((error: unknown) => {
            // A server that cannot answer yet is asked again when it says it can; a stale text is asked again by its own change.
            if (!(error instanceof StaleResultError) && !controller.signal.aborted && !isQuiet(error)) {
                console.warn('Language request failed', error);
            }
        });
    }

    dispose(): void {
        this.disposed = true;
        this.timers.clear(this.timer);
        this.controller?.abort();
    }
}

/* The failures of a server that is not up, does not offer the feature or was asked to stop, which are not worth a line in the console. */
function isQuiet(error: unknown): boolean {
    const code = (error as { code?: number } | null)?.code;
    return code === -32002 || code === -32601 || code === -32800 || code === -32801;
}
