import { describe, expect, test } from 'bun:test';
import { NODE_ACCENTS } from '@/canvas/accents';
import { accentContrast, contrastOf, THEME_SURFACE } from './accent-contrast';

const WHITE = '#ffffff';
const NEAR_BLACK = '#18181b';

/* The ten of the picker's colors white falls under 4.5:1 on. */
const DARK_TEXT_ACCENTS = ['default', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky'];

const COLORS = [
    ...NODE_ACCENTS.map((entry) => ({ name: entry.id as string, color: entry.color })),
    { name: 'near-white', color: '#fafafa' },
    { name: 'near-black', color: '#0a0a0a' }
];

describe('the contrast ratio', () => {
    test('is 21 between black and white and 1 for one color', () => {
        expect(contrastOf('#000000', WHITE)).toBeCloseTo(21, 5);
        expect(contrastOf('#7c74ff', '#7c74ff')).toBe(1);
    });
});

describe('the text on an accent', () => {
    test.each(COLORS)('takes the higher of white and near-black for $name', ({ color }) => {
        const { text } = accentContrast(color, THEME_SURFACE.light, 'light');
        const other = text === WHITE ? NEAR_BLACK : WHITE;

        expect(contrastOf(color, text)).toBeGreaterThanOrEqual(contrastOf(color, other));
    });

    test('is the same on either side', () => {
        for (const { color } of COLORS) {
            expect(accentContrast(color, THEME_SURFACE.light, 'light').text).toBe(accentContrast(color, THEME_SURFACE.dark, 'dark').text);
        }
    });

    test('is near-black on the ten colors white cannot carry, and white on the rest', () => {
        for (const entry of NODE_ACCENTS) {
            const { text } = accentContrast(entry.color, THEME_SURFACE.light, 'light');

            expect(text).toBe(DARK_TEXT_ACCENTS.includes(entry.id) ? NEAR_BLACK : WHITE);
        }

        expect(accentContrast('#fafafa', THEME_SURFACE.light, 'light').text).toBe(NEAR_BLACK);
        expect(accentContrast('#0a0a0a', THEME_SURFACE.dark, 'dark').text).toBe(WHITE);
    });
});

describe('the accent on a surface', () => {
    describe.each(['light', 'dark'] as const)('on %s', (side) => {
        test.each(COLORS)('reaches 3:1 for $name, and stays the color when it already does', ({ color }) => {
            const { onSurface } = accentContrast(color, THEME_SURFACE[side], side);

            expect(contrastOf(onSurface, THEME_SURFACE[side])).toBeGreaterThanOrEqual(3);

            if (contrastOf(color, THEME_SURFACE[side]) >= 3) {
                expect(onSurface).toBe(color);
            }
        });
    });

    test('mixes toward black on light and toward white on dark, only where the color fails', () => {
        const yellow = NODE_ACCENTS.find((entry) => entry.id === 'yellow')!.color;
        const indigo = NODE_ACCENTS.find((entry) => entry.id === 'indigo')!.color;

        expect(accentContrast(yellow, THEME_SURFACE.light, 'light').onSurface).not.toBe(yellow);
        expect(accentContrast(yellow, THEME_SURFACE.dark, 'dark').onSurface).toBe(yellow);
        expect(accentContrast(indigo, THEME_SURFACE.dark, 'dark').onSurface).not.toBe(indigo);
        expect(accentContrast(indigo, THEME_SURFACE.light, 'light').onSurface).toBe(indigo);
        expect(accentContrast('#fafafa', THEME_SURFACE.light, 'light').onSurface).not.toBe('#fafafa');
        expect(accentContrast('#0a0a0a', THEME_SURFACE.dark, 'dark').onSurface).not.toBe('#0a0a0a');
    });

    test('follows the surface it is given', () => {
        const yellow = NODE_ACCENTS.find((entry) => entry.id === 'yellow')!.color;

        expect(accentContrast(yellow, '#18181b', 'dark').onSurface).toBe(yellow);
        expect(accentContrast(yellow, '#fefce8', 'light').onSurface).not.toBe(yellow);
    });
});
