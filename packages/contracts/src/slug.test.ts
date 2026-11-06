import { describe, expect, test } from 'bun:test';
import { freeSlug, slugOf } from './slug.ts';

describe('the slug of a name', () => {
    test('is lowercase words joined by dashes, with an accent folded into its letter', () => {
        expect(slugOf('Pitch deck: Q4!', 'x')).toBe('pitch-deck-q4');
        expect(slugOf('Café crème', 'x')).toBe('cafe-creme');
        expect(slugOf('ＦＵＬＬ ﬁle', 'x')).toBe('full-file');
    });

    test('is the fallback for a name with nothing to keep', () => {
        expect(slugOf('  --  ', 'design')).toBe('design');
        expect(slugOf('日本', '')).toBe('');
    });

    test('is cut to the length with no dash left at the end', () => {
        expect(slugOf(`${'a'.repeat(47)} b`, 'x')).toBe('a'.repeat(47));
        expect(slugOf('abcdef ghijkl', 'x', 8)).toBe('abcdef-g');
        expect(slugOf('abcdef ghijkl', 'x', 7)).toBe('abcdef');
    });

    test('gets the first number after it that nothing has', () => {
        expect(freeSlug('Morning summary', 'routine', new Set())).toBe('morning-summary');
        expect(freeSlug('Morning summary', 'routine', new Set(['morning-summary']))).toBe('morning-summary-2');
        expect(freeSlug('Morning summary', 'routine', new Set(['morning-summary', 'morning-summary-2']))).toBe('morning-summary-3');
    });
});
