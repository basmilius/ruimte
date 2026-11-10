import { describe, expect, test } from 'bun:test';
import { nextRecents, RECENT_LIMIT, sortByRecency } from './palette-recents';

describe('nextRecents', () => {
    test('puts the last run command first', () => {
        expect(nextRecents(['b', 'c'], 'a')).toEqual(['a', 'b', 'c']);
    });

    test('moves a command that ran before instead of listing it twice', () => {
        expect(nextRecents(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
    });

    test('keeps at most the limit', () => {
        const many = Array.from({ length: RECENT_LIMIT }, (_, i) => `id-${i}`);
        const next = nextRecents(many, 'fresh');
        expect(next.length).toBe(RECENT_LIMIT);
        expect(next[0]).toBe('fresh');
        expect(next).not.toContain(`id-${RECENT_LIMIT - 1}`);
    });
});

describe('sortByRecency', () => {
    const entries = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

    test('splits the remembered rows off, in the remembered order', () => {
        expect(sortByRecency(entries, ['c', 'a'])).toEqual({ recent: [{ id: 'c' }, { id: 'a' }], rest: [{ id: 'b' }] });
    });

    test('drops a remembered id that no longer exists', () => {
        expect(sortByRecency(entries, ['gone', 'b'])).toEqual({ recent: [{ id: 'b' }], rest: [{ id: 'a' }, { id: 'c' }] });
    });

    test('leaves everything as it is without a history', () => {
        expect(sortByRecency(entries, [])).toEqual({ recent: [], rest: entries });
    });
});
