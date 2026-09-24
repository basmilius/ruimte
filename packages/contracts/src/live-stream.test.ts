import { describe, expect, test } from 'bun:test';
import { h264KeyFrame, hevcKeyFrame } from './live-stream.ts';

describe('hevcKeyFrame', () => {
    test('recognizes IRAP units in three and four byte Annex-B framing', () => {
        expect(hevcKeyFrame(new Uint8Array([0, 0, 0, 1, 19 << 1, 1]))).toBe(true);
        expect(hevcKeyFrame(new Uint8Array([0, 0, 1, 21 << 1, 1, 2]))).toBe(true);
        expect(hevcKeyFrame(new Uint8Array([0, 0, 0, 1, 1 << 1, 1]))).toBe(false);
    });
});

describe('h264KeyFrame', () => {
    test('recognizes an access unit that opens with its parameter sets', () => {
        const keyFrame = new Uint8Array([0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x2a, 0, 0, 0, 1, 0x68, 0xce, 0, 0, 1, 0x65, 0x88]);

        expect(h264KeyFrame(keyFrame)).toBe(true);
    });

    test('recognizes an IDR slice on its own and passes over a delta slice', () => {
        expect(h264KeyFrame(new Uint8Array([0, 0, 1, 0x65, 0x88, 0x84]))).toBe(true);
        expect(h264KeyFrame(new Uint8Array([0, 0, 0, 1, 0x41, 0x9a, 0x02]))).toBe(false);
        expect(h264KeyFrame(new Uint8Array([0, 0, 0, 1, 0x09, 0xf0, 0, 0, 0, 1, 0x41, 0x9a]))).toBe(false);
    });
});
