import { describe, expect, it } from 'bun:test';
import { isHumpBoundary, isWordBoundary, wordBoundary } from './words.ts';

describe('word boundaries', () => {
    it('recognizes camel humps, acronym ends, digits, dollars and underscores', () => {
        for (const [text, offset] of [
            ['fooBar', 3],
            ['XMLParser', 3],
            ['foo2Bar', 4],
            ['foo_bar', 4],
            ['$value', 1]
        ] as const) {
            expect(isHumpBoundary(text, offset, true), `${text}:${offset}`).toBe(true);
            expect(isWordBoundary(text, offset, true, true)).toBe(true);
        }
        expect(isWordBoundary('fooBar', 3, false, true)).toBe(false);
        expect(isWordBoundary('foo_bar', 3, true, false)).toBe(true);
        expect(isWordBoundary('foo_bar', 3, true, true)).toBe(false);
        expect(isWordBoundary('foo_bar', 4, true, true)).toBe(true);
    });

    it('recognizes Java identifier categories and punctuation groups', () => {
        expect(isWordBoundary('éclair Δelta', 7, false, true)).toBe(true);
        expect(isWordBoundary('a..b', 1, false, false)).toBe(true);
        expect(isWordBoundary('a..b', 2, false, true)).toBe(false);
        expect(isWordBoundary('a..b', 3, false, true)).toBe(true);
        expect(isWordBoundary('e\u0301clair', 1, false, false)).toBe(false);
        expect(isHumpBoundary('ªB', 1, true)).toBe(true);
        expect(isHumpBoundary('fooⅠ', 3, true)).toBe(true);
    });

    it('navigates words without stopping inside surrogate pairs', () => {
        expect(wordBoundary('hello world', 0, 1)).toBe(5);
        expect(wordBoundary('hello world', 5, 1)).toBe(11);
        expect(wordBoundary('hello world', 11, -1)).toBe(6);
        expect(wordBoundary('a😀b', 1, 1)).toBe(3);
        expect(wordBoundary('fooBar', 0, 1)).toBe(3);
    });
});
