import { describe, expect, test } from 'bun:test';
import { controlMessages, encodeScroll, encodeTouch, ScrcpyProtocolError, ScrcpyVideoReader } from './scrcpy-protocol.ts';

const codecH264 = new Uint8Array([0x68, 0x32, 0x36, 0x34]);

const session = (width: number, height: number): Uint8Array => {
    const bytes = new DataView(new ArrayBuffer(12));
    bytes.setUint8(0, 0x80);
    bytes.setUint32(4, width);
    bytes.setUint32(8, height);
    return new Uint8Array(bytes.buffer);
};

const packet = (flags: number, payload: number[]): Uint8Array => {
    const bytes = new DataView(new ArrayBuffer(12 + payload.length));
    bytes.setUint8(0, flags);
    bytes.setUint8(7, 42);
    bytes.setUint32(8, payload.length);
    new Uint8Array(bytes.buffer).set(payload, 12);
    return new Uint8Array(bytes.buffer);
};

const join = (...parts: Uint8Array[]): Uint8Array => {
    const joined = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
    let offset = 0;
    for (const part of parts) {
        joined.set(part, offset);
        offset += part.byteLength;
    }
    return joined;
};

const sps = [0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x2a];
const idr = [0, 0, 0, 1, 0x65, 0x88];
const slice = [0, 0, 0, 1, 0x41, 0x9a];

describe('ScrcpyVideoReader', () => {
    test('puts the codec configuration in front of every key frame', () => {
        const reader = new ScrcpyVideoReader({ dummyByte: true });
        const stream = join(new Uint8Array([0]), codecH264, session(916, 2048), packet(0x40, sps), packet(0x20, idr), packet(0x00, slice), packet(0x20, idr));

        expect(reader.push(stream)).toEqual([
            { width: 916, height: 2048, keyFrame: true, data: new Uint8Array([...sps, ...idr]) },
            { width: 916, height: 2048, keyFrame: false, data: new Uint8Array(slice) },
            { width: 916, height: 2048, keyFrame: true, data: new Uint8Array([...sps, ...idr]) }
        ]);
    });

    test('reads a stream that arrives one byte at a time', () => {
        const reader = new ScrcpyVideoReader({ dummyByte: false });
        const stream = join(codecH264, session(572, 1280), packet(0x40, sps), packet(0x20, idr));
        const frames = [...stream].flatMap((byte) => reader.push(new Uint8Array([byte])));

        expect(frames).toEqual([{ width: 572, height: 1280, keyFrame: true, data: new Uint8Array([...sps, ...idr]) }]);
    });

    test('takes the size of a new capture session and drops the old configuration', () => {
        const reader = new ScrcpyVideoReader({ dummyByte: false });
        reader.push(join(codecH264, session(916, 2048), packet(0x40, sps), packet(0x20, idr)));

        expect(reader.push(join(session(2048, 916), packet(0x20, idr)))).toEqual([{ width: 2048, height: 916, keyFrame: true, data: new Uint8Array(idr) }]);
    });

    test('refuses a codec other than H.264', () => {
        const reader = new ScrcpyVideoReader({ dummyByte: false });

        expect(() => reader.push(new Uint8Array([0x68, 0x32, 0x36, 0x35]))).toThrow(ScrcpyProtocolError);
    });
});

describe('control messages', () => {
    const screen = { width: 1000, height: 2000 };

    test('writes a touch in screen pixels with full pressure while down', () => {
        const message = new DataView(encodeTouch(0, 1, 0.25, 0.5, screen).buffer);

        expect(message.byteLength).toBe(32);
        expect(message.getUint8(0)).toBe(2);
        expect(message.getUint8(1)).toBe(0);
        expect(message.getBigInt64(2)).toBe(1n);
        expect([message.getInt32(10), message.getInt32(14)]).toEqual([250, 1000]);
        expect([message.getUint16(18), message.getUint16(20)]).toEqual([1000, 2000]);
        expect(message.getUint16(22)).toBe(0xffff);
    });

    test('lets go of a touch without pressure and keeps the edge on the screen', () => {
        const message = new DataView(encodeTouch(1, 0, 1, 1, screen).buffer);

        expect([message.getInt32(10), message.getInt32(14)]).toEqual([999, 1999]);
        expect(message.getUint16(22)).toBe(0);
    });

    test('writes scroll steps as fixed point clamped to sixteen steps', () => {
        const message = new DataView(encodeScroll(0.5, 0.5, 0, -40, screen).buffer);

        expect(message.byteLength).toBe(21);
        expect(message.getUint8(0)).toBe(3);
        expect(message.getInt16(13)).toBe(0);
        expect(message.getInt16(15)).toBe(-0x8000);
    });

    test('turns buttons into a key press and pinches into two pointers', () => {
        const [down, up] = controlMessages({ kind: 'button', button: 'back' }, screen);

        expect([...down!]).toEqual([0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0]);
        expect(up![1]).toBe(1);
        const pinch = controlMessages({ kind: 'multiPointer', phase: 'move', first: { x: 0.4, y: 0.5 }, second: { x: 0.6, y: 0.5 } }, screen);
        expect(pinch.map((message) => new DataView(message.buffer).getBigInt64(2))).toEqual([0n, 1n]);
        expect(pinch.map((message) => message[1])).toEqual([2, 2]);
        expect(controlMessages({ kind: 'rotate', direction: 'left' }, screen)).toEqual([new Uint8Array([11])]);
    });
});
