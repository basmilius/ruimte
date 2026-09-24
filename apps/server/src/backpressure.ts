import type { DeviceFrame, ServerFrame, SessionOutputEvent } from '@ruimte/contracts';

// A client that is this far behind is not going to catch up by having more frames queued for it;
// its terminal output is dropped from here on and repaired with a screen instead.
export const HIGH_WATER_MARK = 1_048_576;

// Where streaming resumes. A quarter of the high mark, so the resync screens land on a queue that
// is almost empty rather than on one that is about to fill up again.
export const LOW_WATER_MARK = 262_144;

// Past this Bun closes the socket rather than drop a frame without a word: a lost reply hangs its
// request and a lost chat event leaves a hole in the seq, while a reconnect resumes from `since`.
export const SOCKET_BACKPRESSURE_LIMIT = 16 * 1_048_576;

export interface BackpressuredSocket {
    // Bun answers 0 when the frame was dropped, -1 when it was queued under backpressure, else the byte count.
    send(data: string): number;
    getBufferedAmount(): number;
}

export type DeviceStream = Pick<DeviceFrame, 'backendId' | 'deviceId'>;

export interface OutputGateOptions {
    socket: BackpressuredSocket;
    /*
     * Hands `deliver` the screen of a session this client watches, from inside the step that makes
     * its stream continue that screen. False for a session this client no longer has: its mark goes without a frame.
     */
    screenOf(sessionId: string, deliver: (screen: string) => void): boolean;
    /* A video stream this client lost frames of decodes again only from a key frame. */
    requestKeyFrame?(stream: DeviceStream): void;
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

const deviceFrameOf = (frame: ServerFrame): DeviceFrame | null => ('event' in frame && frame.event === 'device.frame' ? (frame.payload as DeviceFrame) : null);

const replaceableFrame = (frame: ServerFrame): boolean => 'event' in frame && frame.event === 'browser.frame';

const deviceStreamKey = (stream: DeviceStream): string => JSON.stringify([stream.backendId, stream.deviceId]);

/*
 * Drops terminal output and live frames above the socket's high-water mark to bound memory. Once
 * drained, each affected session receives a fresh screen before streaming resumes, and each video
 * stream that lost a frame asks for a key frame.
 */
export class OutputGate {
    private readonly socket: BackpressuredSocket;
    private readonly screenOf: OutputGateOptions['screenOf'];
    private readonly requestKeyFrame: OutputGateOptions['requestKeyFrame'] | null;
    private readonly highWaterMark: number;
    private readonly lowWaterMark: number;
    private paused = false;
    private resyncing = false;
    // Sessions whose stream has a hole in it; each needs a screen before its output may flow again.
    private readonly stale = new Set<string>();
    // Video streams that lost a frame; nothing but a key frame gets through until one does.
    private readonly awaitingKeyFrame = new Map<string, DeviceStream>();

    constructor(options: OutputGateOptions) {
        this.socket = options.socket;
        this.screenOf = options.screenOf;
        this.requestKeyFrame = options.requestKeyFrame ?? null;
        this.highWaterMark = options.highWaterMark ?? HIGH_WATER_MARK;
        this.lowWaterMark = options.lowWaterMark ?? LOW_WATER_MARK;
    }

    /* The sessions still waiting for a screen; for tests and diagnostics. */
    staleSessions(): string[] {
        return [...this.stale];
    }

    send(frame: ServerFrame): void {
        const device = deviceFrameOf(frame);
        if (device !== null) {
            this.sendDeviceFrame(frame, device);
            return;
        }
        if (replaceableFrame(frame) && this.behind()) {
            this.paused = true;
            return;
        }
        const sessionId = outputSessionId(frame);
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
        for (const stream of this.awaitingKeyFrame.values()) {
            this.requestKeyFrame?.(stream);
        }
        void this.resync();
    }

    private behind(): boolean {
        return this.paused || this.socket.getBufferedAmount() > this.highWaterMark;
    }

    // A picture stands in for the one before it; a video frame without `keyFrame` cannot be skipped to.
    private sendDeviceFrame(frame: ServerFrame, device: DeviceFrame): void {
        const key = deviceStreamKey(device);
        if (this.awaitingKeyFrame.has(key) && device.keyFrame !== true) {
            return;
        }
        const video = device.keyFrame !== undefined;
        if (this.behind()) {
            this.paused = true;
            if (video) {
                this.awaitingKeyFrame.set(key, { backendId: device.backendId, deviceId: device.deviceId });
            }
            return;
        }
        this.awaitingKeyFrame.delete(key);
        if (this.write(frame, null) === 0 && video) {
            this.awaitingKeyFrame.set(key, { backendId: device.backendId, deviceId: device.deviceId });
        }
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
                await new Promise<void>((done) => {
                    const watching = this.screenOf(sessionId, (screen) => {
                        this.stale.delete(sessionId);
                        this.write({ type: 'event', event: 'session.resync', payload: { sessionId, screen } }, sessionId);
                        done();
                    });
                    if (!watching) {
                        this.stale.delete(sessionId);
                        done();
                    }
                });
            }
        } finally {
            this.resyncing = false;
        }
    }

    private write(frame: ServerFrame, sessionId: string | null): number {
        const status = this.socket.send(JSON.stringify(frame));
        if (status === 0 && sessionId !== null) {
            // Dropped rather than queued, so this session has a hole again whatever the queue does next.
            this.stale.add(sessionId);
        }
        if (status <= 0 || this.socket.getBufferedAmount() > this.highWaterMark) {
            this.paused = true;
        }
        return status;
    }
}
