import { describe, expect, test } from 'bun:test';
import { idleVoiceBands } from '@/voice/idle-waveform';

describe('idle voice waveform', () => {
    test('keeps every band subtle and finite', () => {
        for (const at of [0, 5_000, 7_999, 16_000, 29_000]) {
            const bands = idleVoiceBands(at, 32);
            expect(bands.input).toHaveLength(32);
            expect(bands.output).toHaveLength(32);
            expect([...bands.input, ...bands.output].every((value) => Number.isFinite(value) && value >= 0.04 && value <= 0.58)).toBe(true);
        }
    });

    test('crosses pattern boundaries without a visible jump', () => {
        const before = idleVoiceBands(7_999, 32);
        const after = idleVoiceBands(8_001, 32);
        const largestStep = Math.max(
            ...before.input.map((value, index) => Math.abs(value - after.input[index]!)),
            ...before.output.map((value, index) => Math.abs(value - after.output[index]!))
        );
        expect(largestStep).toBeLessThan(0.01);
    });

    test('cycles through visibly different shapes', () => {
        const shapes = [1_000, 9_000, 17_000, 25_000].map((at) => idleVoiceBands(at, 16).input.map((value) => value.toFixed(3)).join(','));
        expect(new Set(shapes).size).toBe(4);
    });
});
