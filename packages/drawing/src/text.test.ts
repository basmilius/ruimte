import { describe, expect, test } from 'bun:test';
import { approximateMeasure, linesOf, wrapLines, writingFrameOf } from './text.ts';

/* Every glyph is ten wide, so the numbers below read as glyph counts. */
const tens = (line: string): number => line.length * 10;

describe('wrapLines', () => {
    test('breaks between words where the width runs out', () => {
        expect(wrapLines('the quick brown fox', 100, tens)).toEqual(['the quick', 'brown fox']);
    });

    test('a hard line break always breaks, and an empty paragraph stays a line', () => {
        expect(wrapLines('a\n\nb c', 50, tens)).toEqual(['a', '', 'b c']);
    });

    test('a word wider than the box breaks between glyphs', () => {
        expect(wrapLines('abcdefgh ij', 40, tens)).toEqual(['abcd', 'efgh', 'ij']);
    });

    test('a box narrower than one glyph still gets one glyph per line', () => {
        expect(wrapLines('abc', 5, tens)).toEqual(['a', 'b', 'c']);
    });
});

describe('linesOf', () => {
    const text = {
        kind: 'text' as const,
        id: 't',
        x: 0,
        y: 0,
        w: 100,
        h: 20,
        stroke: 'ink' as const,
        strokeWidth: 1 as const,
        seed: 1,
        text: 'the quick brown fox',
        size: 20
    };

    test('a text that was never resized is set as typed, however wide it is', () => {
        expect(linesOf(text, tens)).toEqual(['the quick brown fox']);
    });

    test('a sized text wraps at its box', () => {
        expect(linesOf({ ...text, sized: true }, tens)).toEqual(['the quick', 'brown fox']);
    });

    test('a note wraps within its padding, not at the edge of its paper', () => {
        // 100 wide minus 16 on either side leaves room for six glyphs of ten.
        const note = { ...text, kind: 'note' as const, text: 'the quick brown fox' };
        expect(linesOf(note, tens)).toEqual(['the', 'quick', 'brown', 'fox']);
        expect(writingFrameOf(note)).toEqual({ x: 16, y: 16, w: 68 });
    });

    test('a note narrower than its own padding still leaves a sliver to write on', () => {
        expect(writingFrameOf({ ...text, kind: 'note' as const, w: 10 }).w).toBe(1);
    });

    test('the approximate measure is wider for mono than for hand', () => {
        expect(approximateMeasure(20, 'mono')('ab')).toBeGreaterThan(approximateMeasure(20, 'hand')('ab'));
    });
});
