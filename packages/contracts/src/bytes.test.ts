import { describe, expect, test } from 'bun:test';
import { BYTES_REPLY_KIND, BytesReadPayloadSchema, decodeBytesReply, encodeBytesReply } from './bytes.ts';

const header = { mime: 'video/mp4', size: 1000, version: '1700000000000-1000', offset: 256 };

describe('binary bytes replies', () => {
    test('a reply comes back with its id, header and bytes', () => {
        const bytes = new Uint8Array([0, 1, 2, 255, 254]);
        const reply = decodeBytesReply(encodeBytesReply('7', header, bytes));
        expect(reply).toEqual({ id: '7', result: header, bytes });
    });

    test('an empty piece at the end of a file is a reply too', () => {
        expect(decodeBytesReply(encodeBytesReply('8', { ...header, offset: 1000 }, new Uint8Array()))?.bytes.byteLength).toBe(0);
    });

    test('reads a reply that sits inside a larger buffer', () => {
        const frame = encodeBytesReply('9', header, new Uint8Array([4, 5, 6]));
        const larger = new Uint8Array(frame.byteLength + 10);
        larger.set(frame, 10);
        expect(decodeBytesReply(larger.subarray(10))?.bytes).toEqual(new Uint8Array([4, 5, 6]));
    });

    test('refuses another kind, a header past the end and a header that is not a piece', () => {
        const frame = encodeBytesReply('1', header, new Uint8Array([1]));
        expect(decodeBytesReply(Uint8Array.of(BYTES_REPLY_KIND + 1, ...frame.subarray(1)))).toBeNull();
        expect(decodeBytesReply(frame.subarray(0, 12))).toBeNull();
        const head = new TextEncoder().encode(JSON.stringify({ id: '1', result: { mime: 'video/mp4' } }));
        const bad = new Uint8Array(5 + head.byteLength);
        bad[0] = BYTES_REPLY_KIND;
        new DataView(bad.buffer).setUint32(1, head.byteLength);
        bad.set(head, 5);
        expect(decodeBytesReply(bad)).toBeNull();
    });

    test('a payload from a client that knows nothing of binary replies still parses', () => {
        expect(BytesReadPayloadSchema.parse({ resource: { kind: 'file', path: 'a.mp4' }, offset: 0, length: 10 }).binary).toBeUndefined();
    });
});
