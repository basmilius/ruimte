import { FrameAssembler, splitFrame } from '@ruimte/contracts';
import type { RTCDataChannel } from 'werift';
import { LOW_WATER_MARK } from '../backpressure.ts';
import type { ClientChannel } from '../connection.ts';

/* What the adapter needs of a DataChannel. werift's is one; a test hands in a fake with the same few members. */
export interface RawDataChannel {
    readonly label: string;
    readonly readyState: 'connecting' | 'open' | 'closing' | 'closed';
    readonly bufferedAmount: number;
    bufferedAmountLowThreshold: number;
    send(data: string): void;
    close(): void;
    onMessage(listener: (data: string | Uint8Array) => void): void;
    onState(listener: (state: RawDataChannel['readyState']) => void): void;
    onBufferedAmountLow(listener: () => void): void;
}

export const fromWerift = (channel: RTCDataChannel): RawDataChannel => ({
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
    send: (data) => channel.send(data),
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
});

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
}

/*
 * A frame is split into pieces below the peer's max-message-size and joined again on arrival (see
 * `splitFrame`). The rest is shaped after Bun's socket, because the output gate reads it that way:
 * `send` answers the bytes of the whole frame once every piece is queued and 0 when the frame did
 * not go out, `bufferedAmount` is the channel's own, and a drain is the channel's
 * `bufferedamountlow`, which fires at the gate's low-water mark.
 */
export const directChannel = (raw: RawDataChannel): DirectChannel => {
    const closeListeners: Array<() => void> = [];
    const drainListeners: Array<() => void> = [];
    const assembler = new FrameAssembler();
    let reader: ((frame: string) => void) | null = null;
    const waiting: string[] = [];
    let maxChars = UNAUTHENTICATED_FRAME_CHARS;
    let closed = false;

    raw.bufferedAmountLowThreshold = LOW_WATER_MARK;

    const finish = (): void => {
        if (closed) {
            return;
        }
        closed = true;
        reader = null;
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

    raw.onState((state) => {
        if (state === 'closed') {
            finish();
        }
    });
    raw.onBufferedAmountLow(() => {
        if (closed) {
            return;
        }
        for (const listener of drainListeners) {
            listener();
        }
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
            try {
                for (const piece of splitFrame(data)) {
                    raw.send(piece);
                }
            } catch (e) {
                /* Every piece is under the size the peer accepts, so a throw means the channel is going
                   away under us. Half a frame may be out, and the stream after it would not parse, so
                   the channel goes rather than pretending the frame was merely dropped. */
                console.warn('A direct channel refused a frame', e);
                close();
                return 0;
            }
            return Buffer.byteLength(data);
        },
        bufferedAmount: () => raw.bufferedAmount,
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
};
