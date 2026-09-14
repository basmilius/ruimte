import { describe, expect, test } from 'bun:test';
import { DIRECT_PIECE_CHARS, splitFrame } from '@ruimte/contracts';
import { LOW_WATER_MARK } from '../backpressure.ts';
import { AUTHENTICATED_FRAME_CHARS, directChannel, type RawDataChannel } from './data-channel.ts';

class FakeRawChannel implements RawDataChannel {
    readonly label = 'ruimte';
    readyState: RawDataChannel['readyState'] = 'open';
    bufferedAmount = 0;
    bufferedAmountLowThreshold = 0;
    readonly sent: string[] = [];
    closeCalls = 0;
    throwOnSend = false;
    private readonly messageListeners: Array<(data: string | Uint8Array) => void> = [];
    private readonly stateListeners: Array<(state: RawDataChannel['readyState']) => void> = [];
    private readonly lowListeners: Array<() => void> = [];

    send(data: string): void {
        if (this.throwOnSend) {
            throw new Error('Transport closed');
        }
        this.sent.push(data);
        this.bufferedAmount += Buffer.byteLength(data);
    }

    close(): void {
        this.closeCalls += 1;
        this.setState('closed');
    }

    onMessage(listener: (data: string | Uint8Array) => void): void {
        this.messageListeners.push(listener);
    }

    onState(listener: (state: RawDataChannel['readyState']) => void): void {
        this.stateListeners.push(listener);
    }

    onBufferedAmountLow(listener: () => void): void {
        this.lowListeners.push(listener);
    }

    setState(state: RawDataChannel['readyState']): void {
        this.readyState = state;
        for (const listener of this.stateListeners) {
            listener(state);
        }
    }

    deliver(data: string | Uint8Array): void {
        for (const listener of this.messageListeners) {
            listener(data);
        }
    }

    /* The SCTP queue emptied down to the threshold, the way werift reports it. */
    drainTo(amount: number): void {
        const crossed = this.bufferedAmount > this.bufferedAmountLowThreshold && amount <= this.bufferedAmountLowThreshold;
        this.bufferedAmount = amount;
        if (crossed) {
            for (const listener of this.lowListeners) {
                listener();
            }
        }
    }
}

describe('directChannel', () => {
    test('send answers the bytes of the whole frame, never the undefined a DataChannel returns', () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw);
        expect(channel.send('{"text":"héllo"}')).toBe(Buffer.byteLength('{"text":"héllo"}'));
        expect(raw.sent).toEqual(['={"text":"héllo"}']);
    });

    test('a frame larger than a piece goes out in pieces the peer can join', () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw);
        const frame = 'z'.repeat(DIRECT_PIECE_CHARS * 2 + 1);
        expect(channel.send(frame)).toBe(frame.length);
        expect(raw.sent).toEqual(splitFrame(frame));
    });

    test('a frame on a channel that is not open was dropped, which is 0', () => {
        const raw = new FakeRawChannel();
        raw.readyState = 'connecting';
        expect(directChannel(raw).send('{}')).toBe(0);
    });

    test('a channel that throws on send is closed and the frame counts as dropped', () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw);
        let closed = 0;
        channel.onClose(() => {
            closed += 1;
        });
        raw.throwOnSend = true;
        const warn = console.warn;
        console.warn = () => undefined;
        try {
            expect(channel.send('{}')).toBe(0);
        } finally {
            console.warn = warn;
        }
        expect(closed).toBe(1);
        expect(channel.send('{}')).toBe(0);
    });

    test('bufferedAmount is the channel own, so the output gate pauses on it', () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw);
        channel.send('x'.repeat(1000));
        expect(channel.bufferedAmount()).toBe(raw.bufferedAmount);
        expect(channel.bufferedAmount()).toBeGreaterThan(1000);
    });

    test('a drain is bufferedamountlow at the low-water mark', () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw);
        expect(raw.bufferedAmountLowThreshold).toBe(LOW_WATER_MARK);
        let drains = 0;
        channel.onDrain(() => {
            drains += 1;
        });
        raw.bufferedAmount = 2_000_000;
        raw.drainTo(LOW_WATER_MARK + 1);
        expect(drains).toBe(0);
        raw.drainTo(LOW_WATER_MARK);
        expect(drains).toBe(1);
    });

    test('close tells its listeners once, whether it came from here or from the channel', () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw);
        let closed = 0;
        channel.onClose(() => {
            closed += 1;
        });
        channel.close(4001, 'Access revoked');
        raw.setState('closed');
        expect(raw.closeCalls).toBe(1);
        expect(closed).toBe(1);

        const other = new FakeRawChannel();
        const remote = directChannel(other);
        remote.onClose(() => {
            closed += 1;
        });
        other.setState('closing');
        expect(closed).toBe(1);
        other.setState('closed');
        expect(closed).toBe(2);
        // A listener that arrives after the end hears it straight away rather than never.
        remote.onClose(() => {
            closed += 1;
        });
        expect(closed).toBe(3);
    });

    test('no drain and no frame reach anyone once the channel closed', () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw);
        const frames: string[] = [];
        let drains = 0;
        channel.receiveWith((frame) => frames.push(frame), AUTHENTICATED_FRAME_CHARS);
        channel.onDrain(() => {
            drains += 1;
        });
        channel.close(1000, 'done');
        raw.bufferedAmount = LOW_WATER_MARK + 10;
        raw.drainTo(0);
        raw.deliver('={"id":"1"}');
        expect(drains).toBe(0);
        expect(frames).toEqual([]);
    });

    test('pieces are joined into frames for the current reader, text or bytes', () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw);
        const frames: string[] = [];
        channel.receiveWith((frame) => frames.push(frame), AUTHENTICATED_FRAME_CHARS);
        raw.deliver('+{"id":');
        raw.deliver(new TextEncoder().encode('="1"}'));
        expect(frames).toEqual(['{"id":"1"}']);
    });

    test('before a reader raises the limit, a large frame from the peer closes the channel', () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw);
        channel.receiveWith(() => undefined, 16);
        raw.deliver(`=${'x'.repeat(17)}`);
        expect(raw.readyState).toBe('closed');
    });
});
