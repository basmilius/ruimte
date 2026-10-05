import { describe, expect, test } from 'bun:test';
import { changedSpan, changedSpans } from './text-span.ts';

function apply(before: string, after: string): string {
    const span = changedSpan(before, after);
    return span === null ? before : before.slice(0, span.start) + span.text + before.slice(span.end);
}

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

function applySpans(before: string, after: string): string {
    let result = '';
    let at = 0;
    for (const span of changedSpans(before, after)) {
        result += before.slice(at, span.start) + span.text;
        at = span.end;
    }
    return result + before.slice(at);
}

describe('changedSpans', () => {
    test('is empty for the same text', () => {
        expect(changedSpans('a\nb', 'a\nb')).toEqual([]);
    });

    test('keeps the lines between two far apart changes out of every span', () => {
        const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`);
        const changed = [...lines];
        changed[5] = 'line five';
        changed[290] = 'line 290 and more';
        const spans = changedSpans(lines.join('\n'), changed.join('\n'));
        expect(spans).toEqual([
            { start: lines.slice(0, 5).join('\n').length + 1 + 'line '.length, end: lines.slice(0, 6).join('\n').length, text: 'five' },
            { start: lines.slice(0, 291).join('\n').length, end: lines.slice(0, 291).join('\n').length, text: ' and more' }
        ]);
    });

    test('names an inserted and a deleted run of lines as spans of their own', () => {
        expect(changedSpans('a\nb\nc\nd\ne', 'a\nX\nY\nb\nc\ne')).toEqual([
            { start: 2, end: 2, text: 'X\nY\n' },
            { start: 6, end: 8, text: '' }
        ]);
    });

    test('rebuilds the text for texts that differ in many places', () => {
        let seed = 7;
        const random = (limit: number): number => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed % limit;
        };
        for (let round = 0; round < 300; round++) {
            const before = Array.from({ length: random(40) }, () => 'abc'.charAt(random(3)).repeat(random(3))).join('\n') + (random(2) === 0 ? '\n' : '');
            const after = Array.from({ length: random(40) }, () => 'abc'.charAt(random(3)).repeat(random(3))).join(random(4) === 0 ? '\r\n' : '\n');
            expect(applySpans(before, after)).toBe(after);
            const spans = changedSpans(before, after);
            for (let i = 1; i < spans.length; i++) {
                expect(spans[i]!.start).toBeGreaterThanOrEqual(spans[i - 1]!.end);
            }
        }
    });

    test('never splits a surrogate pair', () => {
        const before = 'a\n\u{1F600}\nb\nc';
        const after = 'a\n\u{1F601}\nb\nz';
        expect(applySpans(before, after)).toBe(after);
    });

    test('falls back to the one span for a rewrite past the limits', () => {
        const before = Array.from({ length: 3000 }, (_, i) => `old ${i}`).join('\n');
        const after = Array.from({ length: 3000 }, (_, i) => `new ${i}`).join('\n');
        expect(changedSpans(before, after)).toEqual([changedSpan(before, after)!]);
        expect(applySpans(before, after)).toBe(after);
    });
});
