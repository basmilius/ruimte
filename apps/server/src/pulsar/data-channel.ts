import { promisify } from 'node:util';
import { deflateRaw } from 'node:zlib';
import {
    DIRECT_BINARY_PIECE_BYTES,
    DIRECT_DEFLATE_MIN_BYTES,
    DIRECT_PIECE_CHARS,
    FrameAssembler,
    splitBinaryFrame,
    splitDeflatedFrame,
    splitFrame
} from '@ruimte/contracts';
import type { RTCDataChannel } from 'werift';
import { LOW_WATER_MARK, SOCKET_BACKPRESSURE_LIMIT, type OutputShare } from '../backpressure.ts';
import type { ClientChannel } from '../connection.ts';
import { errorText } from '../error-text.ts';

/* What the adapter needs of a DataChannel. werift's is one; a test hands in a fake with the same few members. */
export interface RawDataChannel {
    readonly label: string;
    readonly readyState: 'connecting' | 'open' | 'closing' | 'closed';
    readonly bufferedAmount: number;
    bufferedAmountLowThreshold: number;
    send(data: string | Uint8Array): void;
    close(): void;
    onMessage(listener: (data: string | Uint8Array) => void): void;
    onState(listener: (state: RawDataChannel['readyState']) => void): void;
    onBufferedAmountLow(listener: () => void): void;
}

export function fromWerift(channel: RTCDataChannel): RawDataChannel {
    return {
        get label() {
            return channel.label;
        },
        get readyState() {
            return channel.readyState;
        },
        get bufferedAmount() {
            return channel.bufferedAmount;
        },
        get bufferedAmountLowThreshold() {
            return channel.bufferedAmountLowThreshold;
        },
        set bufferedAmountLowThreshold(value: number) {
            channel.bufferedAmountLowThreshold = value;
        },
        send: (data) => channel.send(typeof data === 'string' ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength)),
        close: () => channel.close(),
        onMessage: (listener) => {
            channel.onMessage.subscribe((data) => listener(data));
        },
        onState: (listener) => {
            channel.stateChanged.subscribe((state) => listener(state));
        },
        onBufferedAmountLow: (listener) => {
            channel.bufferedAmountLow.subscribe(() => listener());
        }
    };
}

// Before the handshake a frame is a challenge answer of a few hundred bytes; nothing larger is read from a stranger.
export const UNAUTHENTICATED_FRAME_CHARS = 4_096;

// The same ceiling Bun puts on a WebSocket message by default, so a frame that fits one fits the other.
export const AUTHENTICATED_FRAME_CHARS = 16 * 1024 * 1024;

/* A DataChannel as a client's channel, with the frames it receives handed to whoever reads them right now. */
export interface DirectChannel extends ClientChannel {
    readonly label: string;
    readonly isOpen: boolean;
    /* Replaces whoever read frames before, with the largest frame the new reader accepts. */
    receiveWith(listener: (frame: string) => void, maxChars: number): void;
    /* From the next frame on, a text frame that deflate shrinks goes deflated; only once the peer chose it. */
    deflate(): void;
    readonly deflating: boolean;
}

/*
 * How much the DataChannel may hold before a binary piece waits here instead: two pieces, so the
 * pipe stays full while a text frame never queues behind more than that.
 */
export const BINARY_LANE_BYTES = DIRECT_BINARY_PIECE_BYTES;

/*
 * How much the DataChannel may hold before a text piece waits here instead. werift wakes every send
 * that waits on its queue at each acknowledgement, so a queue of hundreds of frames slows every byte
 * down: 8 MB took 4 s handed over at once and under 0.5 s in portions (`scripts/measure-wire.ts`).
 */
export const TEXT_LANE_BYTES = 256 * 1024;

const compress = promisify(deflateRaw);

/*
 * A direct channel carries less than a terminal prints (`scripts/measure-latency.ts`), so terminal output
 * waits in the output gate per session and a quiet terminal's echo waits behind one slice of a busy one,
 * not behind its backlog. The budget is above the threshold the drain rides on, so the drain still comes.
 */
const DIRECT_OUTPUT_SHARE: OutputShare = {
    budget: 2 * BINARY_LANE_BYTES,
    backlogChars: 4 * 1_048_576,
    sliceChars: DIRECT_PIECE_CHARS
};

/*
 * A frame is split into pieces below the peer's max-message-size and joined again on arrival (see
 * `splitFrame` and `splitBinaryFrame`). Text pieces, deflated ones among them, wait in a lane in the
 * order they were sent and go while the DataChannel holds no more than `TEXT_LANE_BYTES`; binary
 * pieces (a live frame, a `bytes.read` reply) wait in a lane of their own and go only while no text
 * waits and the DataChannel holds no more than `BINARY_LANE_BYTES`, so a keyframe never sits in front
 * of a reply or terminal output. Every peer joins each kind with an assembler of its own, so they may interleave.
 *
 * The rest is shaped after Bun's socket, because the output gate reads it that way: `send` answers
 * the bytes of the whole frame once accepted for preparation or delivery and 0 when refused,
 * `bufferedAmount` counts the DataChannel, the lanes and pending input, and a drain comes once they
 * are under the gate's low-water mark. A frame that would take that past the socket's backpressure limit closes
 * the channel, as Bun closes a socket there.
 */
export function directChannel(
    raw: RawDataChannel,
    backpressureLimit: number = SOCKET_BACKPRESSURE_LIMIT,
    deflate: (data: string) => Promise<Uint8Array> = compress
): DirectChannel {
    const closeListeners: Array<() => void> = [];
    const drainListeners: Array<() => void> = [];
    const assembler = new FrameAssembler();
    let reader: ((frame: string) => void) | null = null;
    const waiting: string[] = [];
    let maxChars = UNAUTHENTICATED_FRAME_CHARS;
    let closed = false;
    let deflating = false;
    const textLane: Array<{ piece: string | Uint8Array; bytes: number }> = [];
    const lane: Uint8Array[] = [];
    const pendingText: Array<{ data: string; bytes: number; compress: boolean }> = [];
    let preparing = false;
    let pendingBytes = 0;
    let laneBytes = 0;

    const bufferedAmount = (): number => raw.bufferedAmount + laneBytes + pendingBytes;

    raw.bufferedAmountLowThreshold = BINARY_LANE_BYTES;

    const finish = (): void => {
        if (closed) {
            return;
        }
        closed = true;
        reader = null;
        waiting.length = 0;
        pendingText.length = 0;
        textLane.length = 0;
        lane.length = 0;
        pendingBytes = 0;
        laneBytes = 0;
        for (const listener of closeListeners.splice(0)) {
            listener();
        }
    };

    const close = (): void => {
        if (raw.readyState !== 'closed') {
            raw.close();
        }
        finish();
    };

    // Every piece is under the size the peer accepts, so a throw means the channel is going away under us.
    const refused = (e: unknown): void => {
        console.warn('A direct channel refused a frame:', errorText(e));
        close();
    };

    const pump = (): void => {
        try {
            while (!closed && textLane.length > 0 && raw.bufferedAmount <= TEXT_LANE_BYTES) {
                const { piece, bytes } = textLane.shift()!;
                laneBytes -= bytes;
                raw.send(piece);
            }
            while (!closed && textLane.length === 0 && !preparing && pendingText.length === 0 && lane.length > 0 && raw.bufferedAmount <= BINARY_LANE_BYTES) {
                const piece = lane.shift()!;
                laneBytes -= piece.byteLength;
                raw.send(piece);
            }
        } catch (e) {
            refused(e);
        }
    };

    const drained = (): void => {
        if (closed || bufferedAmount() > LOW_WATER_MARK) {
            return;
        }

        for (const listener of drainListeners) {
            if (closed || bufferedAmount() > LOW_WATER_MARK) {
                return;
            }

            listener();
        }
    };

    const queueText = (data: string, bytes: number, deflated: Uint8Array | null): void => {
        if (deflated !== null && deflated.byteLength < bytes) {
            for (const piece of splitDeflatedFrame(deflated)) {
                textLane.push({ piece, bytes: piece.byteLength });
                laneBytes += piece.byteLength;
            }
        } else {
            for (const piece of splitFrame(data)) {
                const pieceBytes = Buffer.byteLength(piece);
                textLane.push({ piece, bytes: pieceBytes });
                laneBytes += pieceBytes;
            }
        }
    };

    const prepareText = (): void => {
        if (closed || preparing) {
            return;
        }

        while (pendingText.length > 0) {
            const frame = pendingText.shift()!;
            if (frame.compress) {
                preparing = true;
                void (async () => {
                    let deflated: Uint8Array | null = null;
                    try {
                        deflated = await deflate(frame.data);
                    } catch {
                        // Plain text is safe before any piece goes out; yield even if the compressor threw synchronously.
                        await Promise.resolve();
                    }

                    if (closed) {
                        return;
                    }

                    pendingBytes -= Math.max(1, frame.bytes);
                    queueText(frame.data, frame.bytes, deflated);
                    preparing = false;
                    prepareText();
                    pump();
                    // Input can shrink below the low mark without the raw channel ever crossing its drain threshold.
                    drained();
                })().catch(refused);

                break;
            }

            pendingBytes -= Math.max(1, frame.bytes);
            queueText(frame.data, frame.bytes, null);
        }
    };

    raw.onState((state) => {
        if (state === 'closed') {
            finish();
        }
    });
    raw.onBufferedAmountLow(() => {
        if (closed) {
            return;
        }

        pump();
        drained();
    });
    raw.onMessage((data) => {
        if (closed) {
            return;
        }
        const piece = typeof data === 'string' ? data : new TextDecoder().decode(data);
        const result = assembler.push(piece, maxChars);
        if (result.kind === 'invalid') {
            // A peer that sends what no client of ours sends is not one to keep reading from.
            close();
            return;
        }
        if (result.kind !== 'frame') {
            return;
        }
        if (reader) {
            reader(result.frame);
            return;
        }
        // The peer may speak first, a moment before this side has anyone reading; that frame waits rather than vanishes.
        waiting.push(result.frame);
    });

    return {
        get label() {
            return raw.label;
        },
        get isOpen() {
            return !closed && raw.readyState === 'open';
        },
        get deflating() {
            return deflating;
        },
        outputShare: DIRECT_OUTPUT_SHARE,
        receiveWith(listener, limit) {
            reader = listener;
            maxChars = limit;
            for (const frame of waiting.splice(0)) {
                if (closed || reader !== listener) {
                    return;
                }
                listener(frame);
            }
        },
        send(data) {
            if (closed || raw.readyState !== 'open') {
                return 0;
            }
            const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
            const queued = bufferedAmount();
            if (queued + Math.max(1, bytes) > backpressureLimit) {
                console.warn(`A direct channel closed with ${queued} bytes still queued for a client that does not keep up.`);
                close();
                return 0;
            }
            if (typeof data !== 'string') {
                for (const piece of splitBinaryFrame(data)) {
                    lane.push(piece);
                    laneBytes += piece.byteLength;
                }
                pump();
                return closed ? 0 : bytes;
            }
            pendingText.push({ data, bytes, compress: deflating && bytes >= DIRECT_DEFLATE_MIN_BYTES });
            // Even an empty frame retains a queue entry and eventually emits a framing byte.
            pendingBytes += Math.max(1, bytes);
            prepareText();
            // A throw here means half a frame may be out and the stream after it would not parse, so the channel goes.
            pump();
            return closed ? 0 : bytes;
        },
        deflate() {
            deflating = true;
        },
        bufferedAmount,
        // A DataChannel has no close code or reason on the wire; the peer only sees the channel end.
        close: () => close(),
        onClose(listener) {
            if (closed) {
                listener();
                return;
            }
            closeListeners.push(listener);
        },
        onDrain(listener) {
            drainListeners.push(listener);
        }
    };
}
