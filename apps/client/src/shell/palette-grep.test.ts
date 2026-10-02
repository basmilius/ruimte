import { describe, expect, test } from 'bun:test';
import type { FsGrepMatch } from '@ruimte/contracts';
import { DEFAULT_GREP_OPTIONS, grepState, type GrepAnswer } from './palette-grep';

const match: FsGrepMatch = { path: 'src/a.ts', line: 3, column: 6, length: 3, text: 'const Foo = 1;', before: [], after: [] };

const answer: GrepAnswer = { folder: '/work', query: 'foo', options: DEFAULT_GREP_OPTIONS, matches: [match], files: 1, truncated: false, failure: null };

describe('find in files', () => {
    test('the answer to what is asked is current', () => {
        expect(grepState(answer, '/work', 'foo ', DEFAULT_GREP_OPTIONS)).toMatchObject({ matches: [match], busy: false });
    });

    test('an answer for other options stays up, but is not current', () => {
        expect(grepState(answer, '/work', 'foo', { ...DEFAULT_GREP_OPTIONS, caseSensitive: true })).toMatchObject({ matches: [match], busy: true });
        expect(grepState(answer, '/work', 'foo', { ...DEFAULT_GREP_OPTIONS, regex: true }).busy).toBe(true);
        expect(grepState(answer, '/work', 'foo', { ...DEFAULT_GREP_OPTIONS, wholeWord: true }).busy).toBe(true);
    });

    test('an answer from another folder is not current', () => {
        expect(grepState(answer, '/other', 'foo', DEFAULT_GREP_OPTIONS).busy).toBe(true);
    });

    test('nothing asked is nothing shown', () => {
        expect(grepState(answer, '/work', '  ', DEFAULT_GREP_OPTIONS)).toEqual({ matches: [], files: 0, truncated: false, failure: null, busy: false });
    });
});
