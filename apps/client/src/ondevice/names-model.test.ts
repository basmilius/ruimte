import { describe, expect, test } from 'bun:test';
import { isValidName, parseNames } from './names-model';

describe('isValidName', () => {
    test('accepts the identifiers of a language and nothing else', () => {
        expect(isValidName('matchedSkills', 'typescript')).toBe(true);
        expect(isValidName('$total', 'typescript')).toBe(true);
        expect(isValidName('$total', 'python')).toBe(false);
        expect(isValidName('match-count', 'typescript')).toBe(false);
        expect(isValidName('match-count', 'css')).toBe(true);
        expect(isValidName('2fast', 'typescript')).toBe(false);
        expect(isValidName('two words', 'typescript')).toBe(false);
        expect(isValidName('class', 'typescript')).toBe(false);
        expect(isValidName('type', 'typescript')).toBe(true);
        expect(isValidName('', 'typescript')).toBe(false);
        expect(isValidName('x'.repeat(65), 'typescript')).toBe(false);
    });
});

describe('parseNames', () => {
    test('reads one name per line without markers, quotes or explanation', () => {
        const output = '1. matchedSkills\n- `matches`: the ones that match\n"foundSkills"\n* hits\nnot a name here\n';
        expect(parseNames(output, 'hits', 'typescript', 5)).toEqual(['matchedSkills', 'matches', 'foundSkills']);
    });

    test('never offers the current name, a name twice, a keyword or a name past the limit', () => {
        expect(parseNames('count\ncount\nreturn\nresult\nvalues\nitems', 'count', 'typescript', 2)).toEqual(['result', 'values']);
    });

    test('keeps the dollar sign of a PHP variable', () => {
        expect(parseNames('orders\n$revenue\ntotal', '$sum', 'php', 3)).toEqual(['$orders', '$revenue', '$total']);
        expect(parseNames('sum\nrevenue', '$sum', 'php', 3)).toEqual(['$revenue']);
    });

    test('is empty for an answer without a usable line', () => {
        expect(parseNames('', 'a', 'typescript', 3)).toEqual([]);
        expect(parseNames('!!!\n???', 'a', 'typescript', 3)).toEqual([]);
    });
});
