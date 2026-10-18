import { describe, expect, test } from 'bun:test';
import { channelsOf, paletteCss } from './palette';

test('a hex color becomes the channels an alpha token reads', () => {
    expect(channelsOf('#155dfc')).toBe('21 93 252');
    expect(channelsOf('#000000')).toBe('0 0 0');
});

describe('palette stylesheet', () => {
    test('writes the accent and its channels per side, over the theme block of that side', () => {
        expect(paletteCss({ light: { accent: '#155dfc' }, dark: { accent: '#f54900' } })).toBe(
            [
                "[data-theme='light'][data-theme] {",
                '    --accent: #155dfc;',
                '    --accent-rgb: 21 93 252;',
                '}',
                "[data-theme='dark'][data-theme] {",
                '    --accent: #f54900;',
                '    --accent-rgb: 245 73 0;',
                '}'
            ].join('\n')
        );
    });

    test('leaves a side without a choice to the theme', () => {
        expect(paletteCss({ light: {}, dark: { accent: '#155dfc' } })).not.toContain("[data-theme='light']");
        expect(paletteCss({ light: {}, dark: {} })).toBe('');
    });

    test('never writes a value that is not a six-digit hex color', () => {
        for (const accent of ['red', '#fff', 'oklch(0.6 0.2 250)', '#155dfc; } body { display: none', '#155dfc\n']) {
            expect(paletteCss({ light: { accent }, dark: { accent } })).toBe('');
        }
    });
});
