import { describe, expect, test } from 'bun:test';
import { BrowserInputPayloadSchema, LIVE_STREAM_MAGIC, LiveStreamDecoder, REQUEST_SCHEMAS, encodeLiveStreamFrame } from './index.ts';

describe('browser contracts', () => {
    test('keeps browser traffic on explicit additive requests', () => {
        expect(
            REQUEST_SCHEMAS['browser.open'].payload.safeParse({
                browserId: 'node-1',
                url: 'https://example.com',
                width: 1280,
                height: 720,
                deviceScaleFactor: 2
            }).success
        ).toBe(true);
        expect(REQUEST_SCHEMAS['browser.open'].payload.safeParse({ browserId: 'node-1', url: 'https://example.com', width: 0, height: 720 }).success).toBe(
            false
        );
        expect(REQUEST_SCHEMAS['browser.resize'].payload.safeParse({ browserId: 'node-1', width: 1280, height: 720, deviceScaleFactor: 3 }).success).toBe(
            false
        );
    });

    test('accepts bounded input and rejects unbounded pasted text', () => {
        expect(BrowserInputPayloadSchema.safeParse({ browserId: 'node-1', input: { kind: 'pointer', phase: 'down', x: 20, y: 30 } }).success).toBe(true);
        expect(BrowserInputPayloadSchema.safeParse({ browserId: 'node-1', input: { kind: 'text', text: 'x'.repeat(65537) } }).success).toBe(false);
    });

    test('decodes frames split across arbitrary transport chunks', () => {
        const encoded = encodeLiveStreamFrame({ sequence: 17, width: 640, height: 360, data: new Uint8Array([1, 2, 3, 4]) });
        const bytes = new Uint8Array(LIVE_STREAM_MAGIC.byteLength + encoded.byteLength);
        bytes.set(LIVE_STREAM_MAGIC);
        bytes.set(encoded, LIVE_STREAM_MAGIC.byteLength);
        const decoder = new LiveStreamDecoder();

        expect(decoder.push(bytes.slice(0, 5))).toEqual([]);
        expect(decoder.push(bytes.slice(5, 13))).toEqual([]);
        expect(decoder.push(bytes.slice(13))).toEqual([{ sequence: 17, width: 640, height: 360, data: new Uint8Array([1, 2, 3, 4]) }]);
    });

    test('rejects an unknown stream preamble', () => {
        const decoder = new LiveStreamDecoder();
        expect(() => decoder.push(new Uint8Array(8))).toThrow('Unknown live stream format');
    });
});
