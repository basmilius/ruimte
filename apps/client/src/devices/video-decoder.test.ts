import { describe, expect, test } from 'bun:test';
import { h264CodecString, VideoDecoderGate } from './video-decoder';

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

        expect(gate.accept(false, 0, 1)).toBeNull();
        expect(gate.accept(true, 0, 2)).toBe('key');
        expect(gate.accept(false, 0, 3)).toBe('delta');

        gate.reset();
        expect(gate.accept(false, 0, 4)).toBeNull();
        expect(gate.accept(true, 0, 5)).toBe('key');
    });

    test('drops queued delta frames without losing the next key frame', () => {
        const gate = new VideoDecoderGate();

        expect(gate.accept(true, 0, 1)).toBe('key');
        expect(gate.accept(false, 9, 2)).toBeNull();
        expect(gate.accept(true, 9, 3)).toBe('key');
    });

    test('decodes on from a key frame the machine skipped to', () => {
        const gate = new VideoDecoderGate();

        expect(gate.accept(true, 0, 1)).toBe('key');
        expect(gate.accept(false, 0, 2)).toBe('delta');
        expect(gate.accept(true, 0, 9)).toBe('key');
        expect(gate.accept(false, 0, 10)).toBe('delta');
    });

    test('a delta frame after a gap waits for the next key frame', () => {
        const gate = new VideoDecoderGate();

        expect(gate.accept(true, 0, 0xffffffff)).toBe('key');
        expect(gate.accept(false, 0, 0)).toBe('delta');
        expect(gate.accept(false, 0, 5)).toBeNull();
        expect(gate.accept(false, 0, 6)).toBeNull();
        expect(gate.accept(true, 0, 7)).toBe('key');
    });
});
