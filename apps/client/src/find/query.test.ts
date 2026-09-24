import { describe, expect, test } from 'bun:test';
import { locateOffset } from './dom-text';
import { compileFind, EMPTY_FIND_QUERY, matchesIn, stepIndex, type FindQuery } from './query';

const pattern = (text: string, options: Partial<FindQuery> = {}): RegExp => {
    const compiled = compileFind({ ...EMPTY_FIND_QUERY, text, ...options });
    if (compiled.kind !== 'pattern') {
        throw new Error(`no pattern for ${text}`);
    }
    return compiled.pattern;
};

describe('matchesIn', () => {
    test('a literal query is read literally', () => {
        expect(matchesIn('a.b axb', pattern('a.b'))).toEqual([{ start: 0, end: 3 }]);
    });

    test('a whole word is whole in any script', () => {
        expect(matchesIn('één eén een', pattern('een', { wholeWord: true }))).toEqual([{ start: 8, end: 11 }]);
    });

    test('an empty match is stepped over instead of looping', () => {
        expect(matchesIn('baab', pattern('a*', { regex: true }))).toEqual([{ start: 1, end: 3 }]);
    });

    test('stops at the limit', () => {
        expect(matchesIn('aaaa', pattern('a'), 2)).toHaveLength(2);
    });
});

describe('stepIndex', () => {
    test('goes round at either end, and starts at the end it walks from', () => {
        expect(stepIndex(2, 3, 1)).toBe(0);
        expect(stepIndex(0, 3, -1)).toBe(2);
        expect(stepIndex(null, 3, -1)).toBe(2);
        expect(stepIndex(null, 0, 1)).toBeNull();
    });
});

describe('locateOffset', () => {
    test('an offset on a seam belongs to the node that starts there', () => {
        expect(locateOffset([0, 4, 9], 4)).toEqual({ index: 1, offset: 0 });
        expect(locateOffset([0, 4, 9], 3)).toEqual({ index: 0, offset: 3 });
        expect(locateOffset([0, 4, 9], 12)).toEqual({ index: 2, offset: 3 });
    });
});
