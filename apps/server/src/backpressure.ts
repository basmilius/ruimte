import { encodeLiveFrame, type DeviceFrame, type LiveFrame, type ServerFrame, type SessionOutputEvent } from '@ruimte/contracts';

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
    send(data: string | Uint8Array): number;
    getBufferedAmount(): number;
}

export type DeviceStream = Pick<DeviceFrame, 'backendId' | 'deviceId'>;

/*
 * How a channel that carries less than a terminal prints shares itself between sessions: once it holds
 * `budget` bytes, output waits in the gate per session and goes round-robin, one slice per turn.
 */
export interface OutputShare {
    budget: number;
    /* Waiting output of one session past this many characters is dropped and repaired with a screen. */
    backlogChars: number;
    /* The most characters of one session in one frame, so no session waits behind a whole tick of another. */
    sliceChars: number;
}

type Waiting = { kind: 'output'; data: string } | { kind: 'event'; frame: string };

interface SessionQueue {
    entries: Waiting[];
    outputChars: number;
}

interface OutputGateOptions {
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
    /* Without one, every frame goes to the socket in the order it was sent. */
    share?: OutputShare;
}

function outputOf(frame: ServerFrame): SessionOutputEvent | null {
    return 'event' in frame && frame.event === 'session.output' ? (frame.payload as SessionOutputEvent) : null;
}

function deviceFrameOf(frame: ServerFrame): DeviceFrame | null {
    return 'event' in frame && frame.event === 'device.frame' ? (frame.payload as DeviceFrame) : null;
}

function replaceableFrame(frame: ServerFrame): boolean {
    return 'event' in frame && frame.event === 'browser.frame';
}

function deviceStreamKey(stream: DeviceStream): string {
    return JSON.stringify([stream.backendId, stream.deviceId]);
}

/* The session an event other than output is about, so it never overtakes that session's waiting output. */
function eventSessionId(frame: ServerFrame): string | null {
    if (!('event' in frame)) {
        return null;
    }
    const sessionId = (frame.payload as { sessionId?: unknown } | null)?.sessionId;
    return typeof sessionId === 'string' ? sessionId : null;
}

/* Never between the halves of a surrogate pair, so every slice is text of its own. */
function sliceEnd(data: string, start: number, sliceChars: number): number {
    const end = Math.min(start + sliceChars, data.length);
    const code = data.charCodeAt(end - 1);
    return end < data.length && end - start > 1 && code >= 0xd800 && code <= 0xdbff ? end - 1 : end;
}

function outputFrame(sessionId: string, data: string): string {
    return JSON.stringify({ type: 'event', event: 'session.output', payload: { sessionId, data } });
}

/*
 * Drops terminal output and live frames above the socket's high-water mark to bound memory. Once
 * drained, each affected session receives a fresh screen before streaming resumes, and each video
 * stream that lost a frame asks for a key frame.
 *
 * With a share, a busy terminal cannot hold back another: its output waits here, in a queue of its
 * own, while replies and every other frame still go at once. An event about a session waits behind
 * that session's output, and a screen taken for a session (`screenTaken`) drops the output it holds.
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
    private readonly share: OutputShare | null;
    // In the order they get their next turn.
    private readonly queues = new Map<string, SessionQueue>();

    constructor(options: OutputGateOptions) {
        this.socket = options.socket;
        this.screenOf = options.screenOf;
        this.requestKeyFrame = options.requestKeyFrame ?? null;
        this.highWaterMark = options.highWaterMark ?? HIGH_WATER_MARK;
        this.lowWaterMark = options.lowWaterMark ?? LOW_WATER_MARK;
        this.share = options.share ?? null;
    }

    /* The sessions still waiting for a screen; for tests and diagnostics. */
    staleSessions(): string[] {
        return [...this.stale];
    }

    /* The sessions whose output waits for its share, in the order of their turns; for tests and diagnostics. */
    waitingSessions(): string[] {
        return [...this.queues.keys()];
    }

    send(frame: ServerFrame): void {
        const device = deviceFrameOf(frame);
        if (device !== null) {
            this.sendDeviceFrame(device, () => frame);
            return;
        }
        if (replaceableFrame(frame) && this.behind()) {
            this.paused = true;
            return;
        }
        const output = outputOf(frame);
        const sessionId = output?.sessionId ?? null;
        if (sessionId !== null && (this.paused || this.stale.has(sessionId))) {
            this.markStale(sessionId);
            return;
        }
        if (this.share !== null && output !== null) {
            this.enqueueOutput(output.sessionId, output.data, this.share);
            this.pump();
            return;
        }
        const about = this.share === null ? null : eventSessionId(frame);
        const queue = about === null ? undefined : this.queues.get(about);
        if (queue !== undefined) {
            queue.entries.push({ kind: 'event', frame: JSON.stringify(frame) });
            return;
        }
        this.write(frame, sessionId);
    }

    /* A screen was taken for this session; the output still waiting for it is in that screen. */
    screenTaken(sessionId: string): void {
        this.dropOutput(sessionId);
    }

    /* A live frame in binary goes or is dropped exactly as the same frame in JSON would. */
    sendLive(live: LiveFrame): void {
        if (live.event === 'device.frame') {
            this.sendDeviceFrame(live.payload, () => encodeLiveFrame(live));
            return;
        }
        if (this.behind()) {
            this.paused = true;
            return;
        }
        this.write(encodeLiveFrame(live), null);
    }

    /* A binary reply is never dropped, as no reply is. */
    sendBinary(frame: Uint8Array): void {
        this.write(frame, null);
    }

    /* Bun's `drain`: the socket has room again, so the sessions that lost output get their screen. */
    onDrain(): void {
        if (this.paused) {
            if (this.socket.getBufferedAmount() > this.lowWaterMark) {
                return;
            }
            this.paused = false;
            for (const stream of this.awaitingKeyFrame.values()) {
                this.requestKeyFrame?.(stream);
            }
        }
        this.pump();
        if (this.stale.size > 0) {
            void this.resync();
        }
    }

    private behind(): boolean {
        return this.paused || this.socket.getBufferedAmount() > this.highWaterMark;
    }

    // A picture stands in for the one before it; a video frame without `keyFrame` cannot be skipped to.
    private sendDeviceFrame(device: Pick<DeviceFrame, 'backendId' | 'deviceId' | 'keyFrame'>, frame: () => ServerFrame | Uint8Array): void {
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
        if (this.write(frame(), null) === 0 && video) {
            this.awaitingKeyFrame.set(key, { backendId: device.backendId, deviceId: device.deviceId });
        }
    }

    private async resync(): Promise<void> {
        if (this.resyncing) {
            return;
        }
        this.resyncing = true;
        try {
            // The marks are read again after every screen: a drain while one was being taken starts no loop of its own.
            for (let sessionId = this.firstStale(); sessionId !== undefined; sessionId = this.firstStale()) {
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

    private markStale(sessionId: string): void {
        this.stale.add(sessionId);
        this.dropOutput(sessionId);
    }

    /* Appends to the last slice while it has room, so the frames stay few while output waits. */
    private enqueueOutput(sessionId: string, data: string, share: OutputShare): void {
        let queue = this.queues.get(sessionId);
        if (queue === undefined) {
            queue = { entries: [], outputChars: 0 };
            this.queues.set(sessionId, queue);
        }
        if (queue.outputChars + data.length > share.backlogChars) {
            this.markStale(sessionId);
            return;
        }
        queue.outputChars += data.length;
        let start = 0;
        const last = queue.entries.at(-1);
        if (last?.kind === 'output' && last.data.length < share.sliceChars) {
            start = sliceEnd(data, 0, share.sliceChars - last.data.length);
            last.data += data.slice(0, start);
        }
        while (start < data.length) {
            const end = sliceEnd(data, start, share.sliceChars);
            queue.entries.push({ kind: 'output', data: data.slice(start, end) });
            start = end;
        }
    }

    // Events about the session stay: they never drop, and they still follow whatever went before them.
    private dropOutput(sessionId: string): void {
        const queue = this.queues.get(sessionId);
        if (queue === undefined) {
            return;
        }
        queue.entries = queue.entries.filter((entry) => entry.kind !== 'output');
        queue.outputChars = 0;
        if (queue.entries.length === 0) {
            this.queues.delete(sessionId);
        }
    }

    /* One entry per session per turn, while the socket holds less than the budget. */
    private pump(): void {
        const share = this.share;
        if (share === null) {
            return;
        }
        while (!this.paused && this.queues.size > 0 && this.socket.getBufferedAmount() < share.budget) {
            const [sessionId, queue] = this.queues.entries().next().value!;
            const entry = queue.entries.shift()!;
            this.queues.delete(sessionId);
            if (queue.entries.length > 0) {
                this.queues.set(sessionId, queue);
            }
            if (entry.kind === 'event') {
                this.write(entry.frame, null);
                continue;
            }
            queue.outputChars -= entry.data.length;
            this.write(outputFrame(sessionId, entry.data), sessionId);
        }
    }

    private firstStale(): string | undefined {
        return this.stale.values().next().value;
    }

    private write(frame: ServerFrame | Uint8Array | string, sessionId: string | null): number {
        const status = this.socket.send(frame instanceof Uint8Array || typeof frame === 'string' ? frame : JSON.stringify(frame));
        if (status === 0 && sessionId !== null) {
            // Dropped rather than queued, so this session has a hole again whatever the queue does next.
            this.markStale(sessionId);
        }
        if (status <= 0 || this.socket.getBufferedAmount() > this.highWaterMark) {
            this.paused = true;
        }
        return status;
    }
}
