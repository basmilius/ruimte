import { describe, expect, test } from 'bun:test';
import { h264CodecString, h264KeyFrame, hevcKeyFrame, VideoDecoderGate } from './video-decoder';

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

describe('h264CodecString', () => {
    test('reads profile, constraint flags and level from the sequence parameter set', () => {
        expect(h264CodecString(new Uint8Array([0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x2a, 0x95]))).toBe('avc1.42C02A');
        expect(h264CodecString(new Uint8Array([0, 0, 0, 1, 0x09, 0xf0, 0, 0, 1, 0x67, 0x64, 0x00, 0x1f, 0xac]))).toBe('avc1.64001F');
    });

    test('has nothing to say without a complete sequence parameter set', () => {
        expect(h264CodecString(new Uint8Array([0, 0, 1, 0x65, 0x88, 0x84]))).toBeNull();
        expect(h264CodecString(new Uint8Array([0, 0, 1, 0x67, 0x42, 0xc0]))).toBeNull();
    });
});

describe('VideoDecoderGate', () => {
    test('waits for a key frame after configure and recovery', () => {
        const gate = new VideoDecoderGate();

        expect(gate.accept(false, 0)).toBeNull();
        expect(gate.accept(true, 0)).toBe('key');
        expect(gate.accept(false, 0)).toBe('delta');

        gate.reset();
        expect(gate.accept(false, 0)).toBeNull();
        expect(gate.accept(true, 0)).toBe('key');
    });

    test('drops queued delta frames without losing the next key frame', () => {
        const gate = new VideoDecoderGate();

        expect(gate.accept(true, 0)).toBe('key');
        expect(gate.accept(false, 9)).toBeNull();
        expect(gate.accept(true, 9)).toBe('key');
    });
});
