import { describe, expect, test } from 'bun:test';
import { PALETTE_PRESETS, palettePresetFrom, presetSample, presetTokens } from './palette-presets';

function luminance(hex: string): number {
    const [red, green, blue] = [1, 3, 5].map((start) => {
        const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function contrast(first: string, second: string): number {
    const [light, dark] = [luminance(first), luminance(second)].sort((x, y) => y - x);
    return (light! + 0.05) / (dark! + 0.05);
}

describe('palette presets', () => {
    test('the default leaves every token to the theme', () => {
        expect(presetTokens('default', 'light')).toEqual({});
        expect(presetTokens('default', 'dark')).toEqual({});
    });

    // WCAG's 4.5:1 for every text a person reads, the muted kind included, on every ground it sits on.
    // The default is the theme's own values, which this file does not write.
    for (const preset of PALETTE_PRESETS.filter((entry) => entry !== 'default')) {
        for (const side of ['light', 'dark'] as const) {
            test(`${preset} on the ${side} side keeps text readable`, () => {
                const tokens = presetTokens(preset, side);
                for (const ground of ['bg', 'surface', 'surface-raised', 'surface-sunken'] as const) {
                    expect(contrast(tokens.text!, tokens[ground]!)).toBeGreaterThanOrEqual(4.5);
                    expect(contrast(tokens['text-muted']!, tokens[ground]!)).toBeGreaterThanOrEqual(4.5);
                }
                expect(contrast(tokens['term-fg']!, tokens['term-bg']!)).toBeGreaterThanOrEqual(4.5);
            });
        }
    }

    test('writes six-digit hex colors only', () => {
        for (const preset of PALETTE_PRESETS) {
            for (const value of Object.values(presetSample(preset, 'dark'))) {
                expect(value).toMatch(/^#[0-9a-f]{6}$/);
            }
        }
    });

    test('a stored preset that is gone reads as the default', () => {
        expect(palettePresetFrom('stone')).toBe('stone');
        expect(palettePresetFrom('sepia')).toBe('default');
        expect(palettePresetFrom(undefined)).toBe('default');
    });
});
