import { describe, expect, test } from 'bun:test';
import { overlayTokens } from './semantic.ts';

const token = (length: number, color: string, fontStyle = 0) => ({ length, color, fontStyle });

describe('overlayTokens', () => {
    test('colors a span inside one token and keeps the rest of it', () => {
        expect(overlayTokens([token(10, '#aaa')], [{ from: 3, to: 6, color: '#f00', fontStyle: 1 }])).toEqual([
            token(3, '#aaa'),
            token(3, '#f00', 1),
            token(4, '#aaa')
        ]);
    });

    test('runs a span across tokens, and keeps the length of the line', () => {
        const result = overlayTokens([token(4, '#a'), token(4, '#b'), token(4, '#c')], [{ from: 2, to: 10, color: '#f00', fontStyle: 0 }]);
        expect(result).toEqual([token(2, '#a'), token(8, '#f00'), token(2, '#c')]);
        expect(result.reduce((sum, entry) => sum + entry.length, 0)).toBe(12);
    });

    test('joins neighbors that end up alike, and takes several spans in order', () => {
        const result = overlayTokens(
            [token(6, '#a'), token(6, '#a')],
            [
                { from: 0, to: 2, color: '#f00', fontStyle: 0 },
                { from: 2, to: 4, color: '#f00', fontStyle: 0 },
                { from: 8, to: 9, color: '#0f0', fontStyle: 0 }
            ]
        );
        expect(result).toEqual([token(4, '#f00'), token(4, '#a'), token(1, '#0f0'), token(3, '#a')]);
    });

    test('leaves a line without spans as it was', () => {
        expect(overlayTokens([token(3, '#a')], [])).toEqual([token(3, '#a')]);
    });
});
