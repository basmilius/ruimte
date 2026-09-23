import { describe, expect, test } from 'bun:test';
import { changedSpan } from './text-span.ts';

const apply = (before: string, after: string): string => {
    const span = changedSpan(before, after);
    return span === null ? before : before.slice(0, span.start) + span.text + before.slice(span.end);
};

describe('changedSpan', () => {
    test('is null for the same text', () => {
        expect(changedSpan('abc', 'abc')).toBeNull();
    });

    test('names only the stretch that differs', () => {
        expect(changedSpan('one\ntwo\nthree', 'one\n2\nthree')).toEqual({ start: 4, end: 7, text: '2' });
    });

    test('covers an insert, a delete and a change at either end', () => {
        expect(changedSpan('abc', 'abxc')).toEqual({ start: 2, end: 2, text: 'x' });
        expect(changedSpan('abxc', 'abc')).toEqual({ start: 2, end: 3, text: '' });
        expect(changedSpan('abc', 'zbc')).toEqual({ start: 0, end: 1, text: 'z' });
        expect(changedSpan('abc', 'abz')).toEqual({ start: 2, end: 3, text: 'z' });
        expect(changedSpan('', 'abc')).toEqual({ start: 0, end: 0, text: 'abc' });
    });

    test('does not let the prefix and the suffix overlap in a repeated run', () => {
        for (const [before, after] of [
            ['aaa', 'aaaa'],
            ['aaaa', 'aa'],
            ['abab', 'ab']
        ] as const) {
            expect(apply(before, after)).toBe(after);
        }
    });

    test('never splits a surrogate pair', () => {
        const span = changedSpan('a\u{1F600}b', 'a\u{1F601}b');
        expect(span).toEqual({ start: 1, end: 3, text: '\u{1F601}' });
        expect(apply('x\u{1F600}', 'x\u{1F600}\u{1F600}')).toBe('x\u{1F600}\u{1F600}');
    });
});
