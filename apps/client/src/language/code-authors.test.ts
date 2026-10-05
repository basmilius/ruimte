import { describe, expect, test } from 'bun:test';
import type { GitBlameCommit } from '@ruimte/contracts';
import { UNCOMMITTED, authorsText, authorshipOf, mapBlame, shortName } from './code-authors';

const commit = (author: string, at: number, summary = 'Change'): GitBlameCommit => ({
    hash: `${author}${at}`.padEnd(40, '0'),
    shortHash: `${author}${at}`.slice(0, 7),
    author,
    email: `${author.toLowerCase()}@example.com`,
    at,
    summary
});

const BASE = ['one', 'two', 'three', 'four', 'five'].join('\n') + '\n';

describe('mapping a blame onto what is typed', () => {
    const blame = { commits: [commit('Ada', 1), commit('Bob', 2)], lines: [0, 0, 1, 1, 0] };

    test('is the blame itself for the text on disk', () => {
        expect([...mapBlame(blame, BASE, BASE.split('\n').slice(0, 5))!]).toEqual([0, 0, 1, 1, 0]);
    });

    test('keeps the commit of a line that moved down and leaves a typed line uncommitted', () => {
        const typed = ['one', 'new', 'two', 'three', 'four', 'five'];
        expect([...mapBlame(blame, BASE, typed)!]).toEqual([0, UNCOMMITTED, 0, 1, 1, 0]);
    });

    test('leaves a changed line uncommitted and keeps the ones around it', () => {
        const typed = ['one', 'two', 'THREE', 'four', 'five'];
        expect([...mapBlame(blame, BASE, typed)!]).toEqual([0, 0, UNCOMMITTED, 1, 0]);
    });

    test('closes the gap where lines were deleted', () => {
        expect([...mapBlame(blame, BASE, ['one', 'four', 'five'])!]).toEqual([0, 1, 0]);
    });

    test('is nothing when the blame is not of the text it is read against', () => {
        expect(mapBlame({ commits: [], lines: [0] }, BASE, ['one'])).toBeNull();
    });

    test('handles a file with no lines and a text that was emptied', () => {
        expect([...mapBlame({ commits: [], lines: [] }, '', ['x'])!]).toEqual([UNCOMMITTED]);
        expect([...mapBlame(blame, BASE, [])!]).toEqual([]);
    });
});

describe('the authors of a range', () => {
    const commits = [commit('Ada', 10), commit('Bob', 30, 'Fix it'), commit('Cy', 20)];
    const lines = ['function a() {', '    one;', '', '    two;', '    three;', '}'];

    test('are counted by lines without the blank ones, the one with most lines first', () => {
        const authorship = authorshipOf(commits, Int32Array.from([0, 1, 1, 1, 2, 0]), lines, 0, 5);
        expect(authorship.authors.map((author) => [author.name, author.lines])).toEqual([
            ['Ada', 2],
            ['Bob', 2],
            ['Cy', 1]
        ]);
        expect(authorship.latest?.author).toBe('Bob');
        expect(authorship.modified).toBe(false);
        expect(authorship.uncommittedLines).toBe(0);
    });

    test('go to the first by name when two wrote as many lines', () => {
        const tied = authorshipOf(commits, Int32Array.from([1, 0, 0, 0, 0, 0]), lines, 0, 1);
        expect(tied.authors.map((author) => [author.name, author.lines])).toEqual([
            ['Ada', 1],
            ['Bob', 1]
        ]);
        const more = authorshipOf(commits, Int32Array.from([1, 0, 0, 1, 1, 0]), lines, 0, 5);
        expect(more.authors[0]).toMatchObject({ name: 'Bob', lines: 3 });
    });

    test('keep the author of a range that is edited, and say it is', () => {
        const authorship = authorshipOf(commits, Int32Array.from([0, 0, UNCOMMITTED, 0, UNCOMMITTED, 0]), lines, 0, 5);
        expect(authorship.authors.map((author) => author.name)).toEqual(['Ada']);
        expect(authorship.modified).toBe(true);
        expect(authorship.uncommittedLines).toBe(1);
    });

    test('are nobody for a range no commit holds yet', () => {
        const authorship = authorshipOf(commits, Int32Array.from([UNCOMMITTED, UNCOMMITTED, UNCOMMITTED, UNCOMMITTED, UNCOMMITTED, UNCOMMITTED]), lines, 0, 5);
        expect(authorship.authors).toEqual([]);
        expect(authorsText(authorship)).toBe('new *');
    });

    test('name a person once whatever address their commits came from', () => {
        const twice = [commit('Ada', 1), { ...commit('Ada', 2), email: 'other@example.com' }];
        const authorship = authorshipOf(twice, Int32Array.from([0, 1, 1, 0, 1, 0]), lines, 0, 5);
        expect(authorship.authors).toHaveLength(1);
        expect(authorship.authors[0]!.lines).toBe(5);
    });
});

describe('the words of a row', () => {
    const one = { authors: [{ name: 'Bas Milius', email: 'b@example.com', lines: 4 }], uncommittedLines: 0, modified: false, latest: null };

    test('are the name, a plus for the others and a star for an edit', () => {
        expect(authorsText(one)).toBe('Bas Milius');
        expect(authorsText({ ...one, modified: true })).toBe('Bas Milius *');
        const more = { ...one, authors: [...one.authors, { name: 'Ada', email: '', lines: 1 }, { name: 'Cy', email: '', lines: 1 }] };
        expect(authorsText(more)).toBe('Bas Milius +2');
        expect(authorsText({ ...more, modified: true })).toBe('Bas Milius +2 *');
    });

    test('collapse the space in a name', () => {
        expect(shortName('  Bas   Milius ')).toBe('Bas Milius');
    });
});
