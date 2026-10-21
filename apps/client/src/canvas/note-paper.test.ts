import { describe, expect, test } from 'bun:test';
import { NODE_ACCENT_NAMES } from '@ruimte/contracts';
import { notePaperClass } from './accents';

const STYLES = await Bun.file(new URL('../styles.css', import.meta.url)).text();
const SWIFT = await Bun.file(new URL('../../../ios/Packages/RuimtePulsar/Sources/RuimtePulsar/RuimteColors.swift', import.meta.url)).text();
// The theme's own text colors (`@adecore/ui/theme.css`), which a note writes its words and its header in.
const TEXT = { light: { text: '#18181b', muted: '#6f6f78' }, dark: { text: '#ececf1', muted: '#9a9aa6' } } as const;
// The sheets notes had before Color covered them keep their exact values.
const KEPT = {
    light: { yellow: '#fff3bf', green: '#dcf5e3', blue: '#dbe9ff', pink: '#fde2ea', neutral: '#ececef' },
    dark: { yellow: '#3b3416', green: '#173a25', blue: '#182f4b', pink: '#43212c', neutral: '#26262d' }
} as const;

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

/* The light block comes first in styles.css and the dark one after it. */
function papers(side: 'light' | 'dark'): Record<string, string> {
    const found = [...STYLES.matchAll(/--paper-([a-z]+): (#[0-9a-f]{6});/g)].map(([, name, value]) => [name!, value!] as const);
    const half = found.length / 2;
    return Object.fromEntries(side === 'light' ? found.slice(0, half) : found.slice(half));
}

describe('the paper of a note', () => {
    for (const side of ['light', 'dark'] as const) {
        test(`has a sheet for every accent and the neutral one on the ${side} side, the old sheets unchanged`, () => {
            const sheets = papers(side);
            expect(Object.keys(sheets).sort()).toEqual([...NODE_ACCENT_NAMES, 'neutral'].sort());
            expect(sheets).toMatchObject(KEPT[side]);
        });

        test(`keeps the words readable on every sheet on the ${side} side, the header no worse than on the old sheets`, () => {
            const sheets = papers(side);
            const oldest = Math.min(...Object.values(KEPT[side]).map((sheet) => contrast(TEXT[side].muted, sheet)));
            for (const sheet of Object.values(sheets)) {
                expect(contrast(TEXT[side].text, sheet)).toBeGreaterThanOrEqual(4.5);
                expect(contrast(TEXT[side].muted, sheet)).toBeGreaterThanOrEqual(oldest);
            }
        });
    }

    test('paints a note without a color on the yellow sheet', () => {
        expect(notePaperClass(null)).toBe('bg-paper-yellow');
        expect(notePaperClass('teal')).toBe('bg-paper-teal');
        expect(notePaperClass('neutral')).toBe('bg-paper-neutral');
    });

    test('names a Tailwind class for each sheet styles.css defines', () => {
        for (const name of [...NODE_ACCENT_NAMES, 'neutral' as const]) {
            expect(STYLES).toContain(`--color-paper-${name}: var(--paper-${name});`);
        }
    });
});

/* The iPhone app keeps the same table by hand, since a color is no wire shape the Swift generator writes. */
describe('the paper of a note on the iPhone', () => {
    test('lists the accents in the order of the desktop', () => {
        const listed = /nodeAccentNames = \[([^\]]*)\]/
            .exec(SWIFT)![1]!
            .match(/"([a-z]+)"/g)!
            .map((name) => name.slice(1, -1));
        expect(listed).toEqual([...NODE_ACCENT_NAMES]);
    });

    test('paints every sheet with the values styles.css gives it', () => {
        const swift = Object.fromEntries(
            [...SWIFT.matchAll(/"([a-z]+)": RuimteColorToken\(light: 0x([0-9a-f]{6}), dark: 0x([0-9a-f]{6})\)/g)].map(([, name, light, dark]) => [
                name!,
                [`#${light}`, `#${dark}`]
            ])
        );
        const light = papers('light');
        const dark = papers('dark');
        expect(Object.keys(swift).sort()).toEqual(Object.keys(light).sort());
        for (const name of Object.keys(light)) {
            expect(swift[name]).toEqual([light[name], dark[name]]);
        }
    });
});
