import { describe, expect, test } from 'bun:test';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import {
    BinaryFrameAssembler,
    DeflatedFrameAssembler,
    DIRECT_BINARY_PIECE_BYTES,
    DIRECT_DEFLATE_MIN_BYTES,
    DIRECT_PIECE_CHARS,
    FrameAssembler
} from '@ruimte/contracts';
import { LOW_WATER_MARK, SOCKET_BACKPRESSURE_LIMIT } from '../backpressure.ts';
import { AUTHENTICATED_FRAME_CHARS, BINARY_LANE_BYTES, directChannel, TEXT_LANE_BYTES, type RawDataChannel } from './data-channel.ts';

class FakeRawChannel implements RawDataChannel {
    readonly label = 'ruimte';
    readyState: RawDataChannel['readyState'] = 'open';
    bufferedAmount = 0;
    bufferedAmountLowThreshold = 0;
    readonly sent: Array<string | Uint8Array> = [];
    closeCalls = 0;
    throwOnSend = false;
    private readonly sentListeners: Array<() => void> = [];
    private readonly messageListeners: Array<(data: string | Uint8Array) => void> = [];
    private readonly stateListeners: Array<(state: RawDataChannel['readyState']) => void> = [];
    private readonly lowListeners: Array<() => void> = [];

    send(data: string | Uint8Array): void {
        if (this.throwOnSend) {
            throw new Error('Transport closed');
        }
        this.sent.push(data);
        this.bufferedAmount += typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
        for (const listener of this.sentListeners) {
            listener();
        }
    }

    async waitForSent(count: number): Promise<void> {
        if (this.sent.length >= count) {
            return;
        }

        const arrival = Promise.withResolvers<void>();
        const listener = (): void => {
            if (this.sent.length >= count) {
                this.sentListeners.splice(this.sentListeners.indexOf(listener), 1);
                arrival.resolve();
            }
        };

        this.sentListeners.push(listener);
        await arrival.promise;
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

class ControlledDeflater {
    readonly requests: Array<{ data: string } & ReturnType<typeof Promise.withResolvers<Uint8Array>>> = [];

    deflate(data: string): Promise<Uint8Array> {
        const request = { data, ...Promise.withResolvers<Uint8Array>() };
        this.requests.push(request);

        return request.promise;
    }

    async complete(index: number, result?: Uint8Array | Error): Promise<void> {
        const request = this.requests[index]!;
        if (result instanceof Error) {
            request.reject(result);
        } else {
            request.resolve(result ?? deflateRawSync(request.data));
        }

        await request.promise.catch(() => undefined);
    }
}

/* The channel warns when it drops a frame, which the test asserts through the count and keeps out of the output. */
function silenced(run: () => void): void {
    const warn = console.warn;
    console.warn = () => undefined;
    try {
        run();
    } finally {
        console.warn = warn;
    }
}

describe('directChannel', () => {
    test('large negotiated text is accepted before compression sends any piece', () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw);
        channel.deflate();
        const frame = 'x'.repeat(DIRECT_DEFLATE_MIN_BYTES * 4);
        expect(channel.send(frame)).toBe(Buffer.byteLength(frame));
        expect(raw.sent).toEqual([]);
        channel.close(1000, 'Done');
    });

    test('a binary frame goes out in binary pieces the peer joins again, and counts its bytes', () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw);
        const frame = Uint8Array.from({ length: DIRECT_BINARY_PIECE_BYTES * 2 }, (_, index) => index % 251);
        expect(channel.send(frame)).toBe(frame.byteLength);
        // Two pieces fill the lane's share of the DataChannel; the third waits until it has room.
        expect(raw.sent).toHaveLength(2);
        expect(channel.bufferedAmount()).toBe(frame.byteLength + 3);
        raw.drainTo(0);
        expect(raw.sent).toHaveLength(3);
        const assembler = new BinaryFrameAssembler();
        const joined = raw.sent.map((piece) => assembler.push(piece as Uint8Array, Number.MAX_SAFE_INTEGER)).at(-1);
        expect(joined).toEqual({ kind: 'frame', frame });
    });

    test('a text frame goes ahead of binary pieces that wait, and both join again on the other side', () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw);
        const picture = Uint8Array.from({ length: DIRECT_BINARY_PIECE_BYTES * 5 }, (_, index) => index % 13);
        channel.send(picture);
        channel.send('{"id":"1","ok":true,"result":{}}');
        expect(raw.sent[2]).toBe('={"id":"1","ok":true,"result":{}}');

        while (raw.sent.length < 7) {
            raw.drainTo(0);
        }
        const text = new FrameAssembler();
        const binary = new BinaryFrameAssembler();
        const frames = raw.sent.map((piece) =>
            typeof piece === 'string' ? text.push(piece, Number.MAX_SAFE_INTEGER) : binary.push(piece, Number.MAX_SAFE_INTEGER)
        );
        expect(frames.filter((result) => result.kind === 'frame')).toEqual([
            { kind: 'frame', frame: '{"id":"1","ok":true,"result":{}}' },
            { kind: 'frame', frame: picture }
        ]);
    });

    test('send answers the bytes of the whole frame, never the undefined a DataChannel returns', () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw);
        expect(channel.send('{"text":"héllo"}')).toBe(Buffer.byteLength('{"text":"héllo"}'));
        expect(raw.sent).toEqual(['={"text":"héllo"}']);
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
        silenced(() => expect(channel.send('{}')).toBe(0));
        expect(closed).toBe(1);
        expect(channel.send('{}')).toBe(0);
    });

    test('a frame that would take the queue past the backpressure limit closes the channel and counts as dropped', () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw, 1000);
        let closed = 0;
        channel.onClose(() => {
            closed += 1;
        });
        expect(channel.send('x'.repeat(600))).toBe(600);
        silenced(() => expect(channel.send('y'.repeat(600))).toBe(0));
        expect(raw.sent).toHaveLength(1);
        expect(raw.closeCalls).toBe(1);
        expect(closed).toBe(1);
    });

    test('the backpressure limit is the socket one by default', () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw);
        raw.bufferedAmount = SOCKET_BACKPRESSURE_LIMIT - 10;
        expect(channel.send('x'.repeat(10))).toBe(10);
        expect(raw.closeCalls).toBe(0);
        silenced(() => expect(channel.send('')).toBe(0));
        expect(raw.closeCalls).toBe(1);
    });

    test('bufferedAmount is the channel own, so the output gate pauses on it', () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw);
        channel.send('x'.repeat(1000));
        expect(channel.bufferedAmount()).toBe(raw.bufferedAmount);
        expect(channel.bufferedAmount()).toBeGreaterThan(1000);
    });

    test('a drain comes once the DataChannel and the lane are both under the low-water mark', () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw);
        expect(raw.bufferedAmountLowThreshold).toBe(BINARY_LANE_BYTES);
        let drains = 0;
        channel.onDrain(() => {
            drains += 1;
        });
        raw.bufferedAmount = 2_000_000;
        raw.drainTo(BINARY_LANE_BYTES + 1);
        expect(drains).toBe(0);
        raw.drainTo(BINARY_LANE_BYTES);
        expect(drains).toBe(1);

        raw.bufferedAmount = BINARY_LANE_BYTES + 1;
        channel.send(new Uint8Array((DIRECT_BINARY_PIECE_BYTES - 1) * 6));
        raw.drainTo(0);
        expect(channel.bufferedAmount()).toBeGreaterThan(LOW_WATER_MARK);
        expect(drains).toBe(1);
        raw.drainTo(0);
        expect(channel.bufferedAmount()).toBeLessThanOrEqual(LOW_WATER_MARK);
        expect(drains).toBe(2);
    });

    test('binary pieces that wait in the lane count toward the backpressure limit', () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw, 200_000);
        raw.bufferedAmount = BINARY_LANE_BYTES + 1;
        expect(channel.send(new Uint8Array(100_000))).toBe(100_000);
        silenced(() => expect(channel.send(new Uint8Array(40_000))).toBe(0));
        expect(raw.closeCalls).toBe(1);
        expect(channel.bufferedAmount()).toBe(raw.bufferedAmount);
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

    test('once deflating, a large text frame goes deflated and inflates back to the frame', async () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw);
        expect(channel.deflating).toBe(false);
        channel.deflate();
        expect(channel.deflating).toBe(true);
        const frame = JSON.stringify({ type: 'event', event: 'chat.items', payload: { text: 'the same words again '.repeat(5_000) } });
        expect(channel.send(frame)).toBe(Buffer.byteLength(frame));
        await raw.waitForSent(1);
        expect(raw.sent.every((piece) => typeof piece !== 'string')).toBe(true);
        const assembler = new DeflatedFrameAssembler();
        const joined = raw.sent.map((piece) => assembler.push(piece as Uint8Array, Number.MAX_SAFE_INTEGER)).at(-1);
        expect(joined?.kind).toBe('frame');
        expect(inflateRawSync((joined as { frame: Uint8Array }).frame).toString()).toBe(frame);
    });

    test('a frame below the threshold, or any frame before deflating, goes as text', () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw);
        const large = `{"text":"${'x'.repeat(DIRECT_DEFLATE_MIN_BYTES * 2)}"}`;
        channel.send(large);
        channel.deflate();
        const small = `{"text":"${'x'.repeat(DIRECT_DEFLATE_MIN_BYTES - 20)}"}`;
        channel.send(small);
        expect(raw.sent).toEqual([`=${large}`, `=${small}`]);
    });

    test('a deflated frame keeps its place between text frames, ahead of binary pieces that wait', async () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw);
        channel.deflate();
        channel.send(Uint8Array.from({ length: DIRECT_BINARY_PIECE_BYTES * 3 }, (_, index) => index % 7));
        channel.send('{"id":"1"}');
        channel.send(`{"id":"2","text":"${'y'.repeat(DIRECT_DEFLATE_MIN_BYTES * 4)}"}`);
        channel.send('{"id":"3"}');
        await raw.waitForSent(5);
        // Two binary pieces were out before the frames; the third waits in the lane behind all three.
        expect(raw.sent.slice(2).map((piece) => (typeof piece === 'string' ? piece : `deflated:${piece[0]}`))).toEqual([
            '={"id":"1"}',
            'deflated:4',
            '={"id":"3"}'
        ]);
    });

    test('only one compression runs at a time and later text and binary wait in order', async () => {
        const raw = new FakeRawChannel();
        const io = new ControlledDeflater();
        const channel = directChannel(raw, SOCKET_BACKPRESSURE_LIMIT, (data) => io.deflate(data));
        channel.deflate();
        const first = 'é'.repeat(DIRECT_DEFLATE_MIN_BYTES);
        const second = 'b'.repeat(DIRECT_DEFLATE_MIN_BYTES * 2);
        const picture = Uint8Array.of(20, 21, 22);
        channel.send(first);
        channel.send(second);
        channel.send('end');
        channel.send(picture);
        expect(io.requests.map(({ data }) => data)).toEqual([first]);
        expect(raw.sent).toEqual([]);
        expect(channel.bufferedAmount()).toBe(Buffer.byteLength(first) + Buffer.byteLength(second) + 3 + 4);

        await io.complete(0);
        expect(io.requests.map(({ data }) => data)).toEqual([first, second]);
        expect(raw.sent).toHaveLength(1);
        expect(channel.bufferedAmount()).toBe(raw.bufferedAmount + Buffer.byteLength(second) + 3 + 4);

        await io.complete(1);
        expect(raw.sent).toHaveLength(4);
        const compressed = new DeflatedFrameAssembler();
        for (const [index, frame] of [first, second].entries()) {
            const result = compressed.push(raw.sent[index] as Uint8Array, Number.MAX_SAFE_INTEGER);
            expect(result.kind).toBe('frame');
            if (result.kind === 'frame') {
                expect(inflateRawSync(result.frame).toString()).toBe(frame);
            }
        }

        expect(raw.sent[2]).toBe('=end');
        expect(new BinaryFrameAssembler().push(raw.sent[3] as Uint8Array, 100)).toEqual({ kind: 'frame', frame: picture });
        expect(channel.bufferedAmount()).toBe(raw.bufferedAmount);
        raw.drainTo(0);
        expect(channel.bufferedAmount()).toBe(0);
    });

    test('pending UTF-8 input and empty frames count toward admission and closure releases them', async () => {
        const raw = new FakeRawChannel();
        const io = new ControlledDeflater();
        const frame = '😀'.repeat(DIRECT_DEFLATE_MIN_BYTES);
        const bytes = Buffer.byteLength(frame);
        const channel = directChannel(raw, bytes + 2, (data) => io.deflate(data));
        channel.deflate();
        expect(channel.send(frame)).toBe(bytes);
        expect(channel.send('')).toBe(0);
        expect(channel.bufferedAmount()).toBe(bytes + 1);
        expect(channel.send('')).toBe(0);
        expect(channel.bufferedAmount()).toBe(bytes + 2);
        silenced(() => expect(channel.send('')).toBe(0));
        expect(raw.closeCalls).toBe(1);
        expect(channel.bufferedAmount()).toBe(0);

        await io.complete(0);
        expect(raw.sent).toEqual([]);
        expect(channel.bufferedAmount()).toBe(0);
    });

    test('compression can release backpressure and signal a drain without any raw drain event', async () => {
        const raw = new FakeRawChannel();
        const io = new ControlledDeflater();
        const channel = directChannel(raw, SOCKET_BACKPRESSURE_LIMIT, (data) => io.deflate(data));
        let drains = 0;
        channel.onDrain(() => {
            drains += 1;
        });
        channel.deflate();
        channel.send('x'.repeat(LOW_WATER_MARK + 1));
        channel.send('y'.repeat(LOW_WATER_MARK + 1));
        expect(channel.bufferedAmount()).toBeGreaterThan(LOW_WATER_MARK);
        expect(raw.bufferedAmount).toBe(0);
        expect(drains).toBe(0);

        await io.complete(0);
        expect(channel.bufferedAmount()).toBeGreaterThan(LOW_WATER_MARK);
        expect(drains).toBe(0);

        await io.complete(1);
        expect(channel.bufferedAmount()).toBeGreaterThan(0);
        expect(channel.bufferedAmount()).toBeLessThan(LOW_WATER_MARK);
        expect(drains).toBe(1);
    });

    test.each(['failure', 'larger output', 'synchronous throw'] as const)('%s sends the original text before later frames', async (outcome) => {
        const raw = new FakeRawChannel();
        const io = new ControlledDeflater();
        const channel = directChannel(raw, SOCKET_BACKPRESSURE_LIMIT, (data) => {
            if (outcome === 'synchronous throw') {
                throw new Error('Compression unavailable');
            }

            return io.deflate(data);
        });
        channel.deflate();
        const frame = 'x'.repeat(DIRECT_DEFLATE_MIN_BYTES);
        channel.send(frame);
        channel.send('after');
        if (outcome === 'synchronous throw') {
            await raw.waitForSent(2);
            expect(raw.sent).toEqual([`=${frame}`, '=after']);
        } else {
            expect(raw.sent).toEqual([]);
            await io.complete(0, outcome === 'failure' ? new Error('Compression unavailable') : new Uint8Array(frame.length));
            expect(raw.sent).toEqual([`=${frame}`, '=after']);
        }

        expect(channel.isOpen).toBe(true);
        expect(channel.bufferedAmount()).toBe(Buffer.byteLength(frame) + 7);
    });

    test.each(['local', 'remote'] as const)('%s close discards pending text and binary and ignores late compression', async (side) => {
        const raw = new FakeRawChannel();
        const io = new ControlledDeflater();
        const channel = directChannel(raw, SOCKET_BACKPRESSURE_LIMIT, (data) => io.deflate(data));
        let closes = 0;
        let drains = 0;
        channel.onClose(() => {
            closes += 1;
        });
        channel.onDrain(() => {
            drains += 1;
        });
        channel.deflate();
        channel.send('x'.repeat(DIRECT_DEFLATE_MIN_BYTES));
        channel.send('y'.repeat(DIRECT_DEFLATE_MIN_BYTES));
        channel.send(Uint8Array.of(1, 2, 3));
        if (side === 'local') {
            channel.close(1000, 'Done');
        } else {
            raw.setState('closed');
        }

        expect(channel.bufferedAmount()).toBe(0);
        expect(closes).toBe(1);
        await io.complete(0);
        expect(raw.sent).toEqual([]);
        expect(io.requests).toHaveLength(1);
        expect(channel.send('late')).toBe(0);
        expect(drains).toBe(0);
        expect(closes).toBe(1);
    });

    test('text past what the DataChannel may hold waits in its lane, counts toward bufferedAmount and goes on in order', () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw);
        const frames = Array.from({ length: 40 }, (_, index) => `{"id":"${index}","text":"${'t'.repeat(DIRECT_PIECE_CHARS)}"}`);
        for (const frame of frames) {
            expect(channel.send(frame)).toBe(Buffer.byteLength(frame));
        }
        expect(raw.bufferedAmount).toBeLessThanOrEqual(TEXT_LANE_BYTES + DIRECT_PIECE_CHARS * 2);
        expect(channel.bufferedAmount()).toBeGreaterThan(frames.join('').length);

        while (raw.sent.length < frames.length * 2) {
            raw.drainTo(0);
        }
        const assembler = new FrameAssembler();
        const joined = raw.sent.flatMap((piece) => {
            const result = assembler.push(piece as string, Number.MAX_SAFE_INTEGER);
            return result.kind === 'frame' ? [result.frame] : [];
        });
        expect(joined).toEqual(frames);
        raw.drainTo(0);
        expect(channel.bufferedAmount()).toBe(0);
    });

    test('a binary piece waits while text waits, and goes once the text is out', () => {
        const raw = new FakeRawChannel();
        const channel = directChannel(raw);
        channel.send('x'.repeat(TEXT_LANE_BYTES * 2));
        channel.send(new Uint8Array(10));
        expect(raw.sent.every((piece) => typeof piece === 'string')).toBe(true);
        while (raw.sent.every((piece) => typeof piece === 'string')) {
            raw.drainTo(0);
        }
        expect(raw.sent.at(-1)).toBeInstanceOf(Uint8Array);
        expect(
            raw.sent
                .slice(0, -1)
                .map((piece) => piece as string)
                .join('')
                .replace(/[+=]/g, '')
        ).toBe('x'.repeat(TEXT_LANE_BYTES * 2));
    });
});
