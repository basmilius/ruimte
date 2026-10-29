import { describe, expect, test } from 'bun:test';
import { BEAM_STYLES, beamPixels, beamStyleOf, type BeamCell, type BeamPixel } from '@/pets/beam';
import { BEAM_LIGHT } from '@/pets/sprite-colors';

// A small figure of three rows: what each beam starts from and ends in.
const FIGURE: BeamCell[] = [
    { x: 10, y: 14, color: '#e9823e' },
    { x: 11, y: 14, color: '#e9823e' },
    { x: 10, y: 15, color: '#542b1b' },
    { x: 11, y: 15, color: '#542b1b' },
    { x: 10, y: 16, color: '#e9823e' },
    { x: 11, y: 16, color: '#e9823e' }
];

function visible(pixels: BeamPixel[]): BeamPixel[] {
    return pixels.filter((pixel) => pixel.alpha > 0);
}

describe('a beam', () => {
    test('in every style, shows nothing before it starts and the figure exactly in place once it is done', () => {
        for (const style of BEAM_STYLES) {
            expect(visible(beamPixels(style, FIGURE, 0))).toEqual([]);
            expect(visible(beamPixels(style, FIGURE, 1))).toEqual(FIGURE.map((cell) => ({ ...cell, alpha: 1 })));
        }
    });

    test('in every style, shows the figure on its way, and the light in the app accent', () => {
        for (const style of BEAM_STYLES) {
            const halfway = visible(beamPixels(style, FIGURE, 0.6));
            expect(halfway.length).toBeGreaterThan(0);
            expect(
                halfway.every((pixel) => pixel.color === 'accent' || pixel.color === BEAM_LIGHT.flash || FIGURE.some((cell) => cell.color === pixel.color))
            ).toBe(true);
        }
    });

    test('takes the style picked, or for Random one of all of them', () => {
        expect(beamStyleOf('portal', 0.9)).toBe('portal');
        expect([0, 0.2, 0.4, 0.6, 0.99, 1].map((pick) => beamStyleOf('random', pick))).toEqual(['gather', 'scan', 'rain', 'transporter', 'portal', 'portal']);
    });
});
