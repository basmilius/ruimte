import { describe, expect, test } from 'bun:test';
import { idleVoiceBands } from '@/voice/idle-waveform';

describe('idle voice waveform', () => {
    test('keeps every band subtle and finite', () => {
        for (const at of [0, 5_000, 7_999, 16_000, 29_000, 43_000, 57_000, 64_000]) {
            const bands = idleVoiceBands(at, 32);
            expect(bands.input).toHaveLength(32);
            expect(bands.output).toHaveLength(32);
            expect([...bands.input, ...bands.output].every((value) => Number.isFinite(value) && value >= 0.04 && value <= 0.7)).toBe(true);
        }
    });

    test('crosses every pattern boundary without a visible jump', () => {
        for (let boundary = 8_000; boundary <= 64_000; boundary += 8_000) {
            const before = idleVoiceBands(boundary - 1, 32);
            const after = idleVoiceBands(boundary + 1, 32);
            const largestStep = Math.max(
                ...before.input.map((value, index) => Math.abs(value - after.input[index]!)),
                ...before.output.map((value, index) => Math.abs(value - after.output[index]!))
            );
            expect(largestStep).toBeLessThan(0.01);
        }
    });

    test('moves through a complete cycle without a sharp frame', () => {
        let previous = idleVoiceBands(0, 32);
        for (let at = 16; at <= 64_000; at += 16) {
            const next = idleVoiceBands(at, 32);
            const largestStep = Math.max(
                ...previous.input.map((value, index) => Math.abs(value - next.input[index]!)),
                ...previous.output.map((value, index) => Math.abs(value - next.output[index]!))
            );
            expect(largestStep).toBeLessThan(0.025);
            previous = next;
        }
    });

    test('cycles through visibly different shapes', () => {
        const shapes = [1_000, 9_000, 17_000, 25_000, 33_000, 41_000, 49_000, 57_000].map((at) =>
            idleVoiceBands(at, 16)
                .input.map((value) => value.toFixed(3))
                .join(',')
        );
        expect(new Set(shapes).size).toBe(8);
    });
});
