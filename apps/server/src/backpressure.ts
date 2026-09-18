import type { ServerFrame, SessionOutputEvent } from '@ruimte/contracts';

// A client that is this far behind is not going to catch up by having more frames queued for it;
// its terminal output is dropped from here on and repaired with a screen instead.
export const HIGH_WATER_MARK = 1_048_576;

// Where streaming resumes. A quarter of the high mark, so the resync screens land on a queue that
// is almost empty rather than on one that is about to fill up again.
export const LOW_WATER_MARK = 262_144;

export interface BackpressuredSocket {
    // Bun answers 0 when the frame was dropped, -1 when it was queued under backpressure, else the byte count.
    send(data: string): number;
    getBufferedAmount(): number;
}

export interface OutputGateOptions {
    socket: BackpressuredSocket;
    // The daemon owns the screen through `@xterm/headless`, so a resync is one serialize.
    // Null for a session this client no longer has: its mark goes without a frame.
    screenOf(sessionId: string): Promise<string | null>;
    highWaterMark?: number;
    lowWaterMark?: number;
}

/* The session a frame streams output for, or null for every other frame; only output is gated. */
const outputSessionId = (frame: ServerFrame): string | null => {
    if (!('event' in frame) || frame.event !== 'session.output') {
        return null;
    }
    return (frame.payload as SessionOutputEvent).sessionId;
};

const replaceableFrame = (frame: ServerFrame): boolean => 'event' in frame && frame.event === 'browser.frame';

/*
 * Drops terminal output above the socket's high-water mark to bound memory. Once drained, each
 * affected session receives a fresh screen before streaming resumes.
 */
export class OutputGate {
    private readonly socket: BackpressuredSocket;
    private readonly screenOf: (sessionId: string) => Promise<string | null>;
    private readonly highWaterMark: number;
    private readonly lowWaterMark: number;
    private paused = false;
    private resyncing = false;
    // Sessions whose stream has a hole in it; each needs a screen before its output may flow again.
    private readonly stale = new Set<string>();

    constructor(options: OutputGateOptions) {
        this.socket = options.socket;
        this.screenOf = options.screenOf;
        this.highWaterMark = options.highWaterMark ?? HIGH_WATER_MARK;
        this.lowWaterMark = options.lowWaterMark ?? LOW_WATER_MARK;
    }

    /* The sessions still waiting for a screen; for tests and diagnostics. */
    staleSessions(): string[] {
        return [...this.stale];
    }

    send(frame: ServerFrame): void {
        const sessionId = outputSessionId(frame);
        if (replaceableFrame(frame) && (this.paused || this.socket.getBufferedAmount() > this.highWaterMark)) {
            this.paused = true;
            return;
        }
        if (sessionId !== null && (this.paused || this.stale.has(sessionId))) {
            this.stale.add(sessionId);
            return;
        }
        this.write(frame, sessionId);
    }

    /* Bun's `drain`: the socket has room again, so the sessions that lost output get their screen. */
    onDrain(): void {
        if (!this.paused || this.socket.getBufferedAmount() > this.lowWaterMark) {
            return;
        }
        this.paused = false;
        void this.resync();
    }

    private async resync(): Promise<void> {
        if (this.resyncing) {
            return;
        }
        this.resyncing = true;
        try {
            for (const sessionId of [...this.stale]) {
                if (this.paused) {
                    // The socket filled up again; whatever is still marked waits for the next drain.
                    return;
                }
                const screen = await this.screenOf(sessionId);
                if (screen === null) {
                    this.stale.delete(sessionId);
                    continue;
                }
                // No await between the serialize and clearing the mark, so no output can slip in
                // between the screen and the stream that continues it.
                this.stale.delete(sessionId);
                this.write({ type: 'event', event: 'session.resync', payload: { sessionId, screen } }, sessionId);
            }
        } finally {
            this.resyncing = false;
        }
    }

    private write(frame: ServerFrame, sessionId: string | null): void {
        const status = this.socket.send(JSON.stringify(frame));
        if (status === 0 && sessionId !== null) {
            // Dropped rather than queued, so this session has a hole again whatever the queue does next.
            this.stale.add(sessionId);
        }
        if (status <= 0 || this.socket.getBufferedAmount() > this.highWaterMark) {
            this.paused = true;
        }
    }
}
