import { describe, expect, test } from 'bun:test';
import { WAVEFORM_BAND_COUNT, bandsOf, easeBands, spectrumBands } from '@/audio/waveform';

const filled = (length: number, value: number): Float32Array => Float32Array.from({ length }, () => value);

describe('reading levels off samples', () => {
    test('draws a bar per band whatever the block size', () => {
        expect(bandsOf(filled(400, 0)).length).toBe(WAVEFORM_BAND_COUNT);
        expect(bandsOf(filled(7, 0)).length).toBe(WAVEFORM_BAND_COUNT);
    });

    test('reads silence as nothing at all', () => {
        expect(bandsOf(filled(400, 0)).every((level) => level === 0)).toBe(true);
    });

    test('never draws past the end of the meter', () => {
        expect(bandsOf(filled(400, 1)).every((level) => level === 1)).toBe(true);
    });

    test('lifts ordinary speech well off the floor', () => {
        // A quarter of full scale is a normal speaking level, and it should look like one.
        const [first] = bandsOf(filled(400, 0.25));
        expect(first).toBeGreaterThan(0.9);
    });

    test('takes a block too short to fill every band without dividing by zero', () => {
        expect(bandsOf(filled(3, 0.5)).every((level) => Number.isFinite(level))).toBe(true);
    });
});

describe('easing the bars', () => {
    test('rises faster than it falls', () => {
        const up = easeBands([0], [1])[0]!;
        const down = 1 - easeBands([1], [0])[0]!;
        expect(up).toBeGreaterThan(down);
    });

    test('starts from nothing when there is no previous band', () => {
        expect(easeBands([], [1])).toEqual([0.38]);
    });
});

describe('speech spectrum', () => {
    test('silence stays at the floor', () => {
        expect(spectrumBands(filled(1024, -Infinity), 16000)).toEqual([0, 0, 0, 0, 0]);
    });

    test('low and high tones activate different bars', () => {
        const low = filled(1024, -Infinity);
        const high = filled(1024, -Infinity);
        low[Math.round(150 / (16000 / 2048))] = -25;
        high[Math.round(4000 / (16000 / 2048))] = -25;
        expect(spectrumBands(low, 16000)).toEqual([0.9, 0, 0, 0, 0]);
        expect(spectrumBands(high, 16000)).toEqual([0, 0, 0, 0, 0.9]);
    });

    test('quiet input is not normalized to full height', () => {
        const quiet = spectrumBands(filled(1024, -60), 16000);
        const loud = spectrumBands(filled(1024, -25), 16000);
        expect(quiet.every((value, index) => value < loud[index]!)).toBe(true);
        expect(spectrumBands(filled(1024, 0), 16000)).toEqual([1, 1, 1, 1, 1]);
    });
});
