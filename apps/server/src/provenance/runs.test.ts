import { describe, expect, test } from 'bun:test';
import type { ProvenanceRun } from '@ruimte/contracts';
import { hashLines } from './line-hash.ts';
import { boundedBefore, dropCommitted, locatedHunks, mapRuns, uncoveredRanges, writtenHunks, type WriteSignature } from './runs.ts';

function run(start: number, end: number, extra: Partial<ProvenanceRun> = {}): ProvenanceRun {
    return { id: `run-${start}`, chatId: 'chat-a', turnId: 'turn-1', at: 1, promptExcerpt: '', start, end, review: 'pending', via: 'tool', ...extra };
}

const lines = (text: string): string[] => text.split(' ');
const hashes = (text: string): string[] => hashLines(lines(text));

describe('mapRuns', () => {
    test('lines inserted above move the run down', () => {
        const mapped = mapRuns([run(2, 3)], hashes('a b c d'), hashes('x y a b c d'));
        expect(mapped.map((entry) => [entry.start, entry.end])).toEqual([[4, 5]]);
    });

    test('a run whose lines were all replaced is gone', () => {
        expect(mapRuns([run(2, 3)], hashes('a b c d'), hashes('a x y d'))).toEqual([]);
    });

    test('a run cut by an edit in its middle stays in two pieces that share the id', () => {
        const mapped = mapRuns([run(1, 5, { before: ['old'] })], hashes('a b c d e'), hashes('a b X d e'));
        expect(mapped.map((entry) => [entry.id, entry.start, entry.end])).toEqual([
            ['run-1', 1, 2],
            ['run-1', 4, 5]
        ]);
        expect(mapped.some((entry) => entry.before !== undefined)).toBe(false);
    });

    test("a line inserted inside a run splits it, since the inserted line is not the agent's", () => {
        const mapped = mapRuns([run(1, 4)], hashes('a b c d'), hashes('a b X c d'));
        expect(mapped.map((entry) => [entry.start, entry.end])).toEqual([
            [1, 2],
            [4, 5]
        ]);
    });

    test('a run that only removed lines follows the place and goes when an edit cuts through it', () => {
        const removal = run(3, 2);
        expect(mapRuns([removal], hashes('a b c d'), hashes('x a b c d')).map((entry) => [entry.start, entry.end])).toEqual([[4, 3]]);
        expect(mapRuns([run(4, 3)], hashes('a b c d e'), hashes('a b X e'))).toEqual([]);
    });

    test('a run keeps what it replaced while it stays whole', () => {
        const mapped = mapRuns([run(2, 3, { before: ['old'] })], hashes('a b c d'), hashes('x a b c d'));
        expect(mapped[0]!.before).toEqual(['old']);
    });
});

describe('dropCommitted', () => {
    test('lines the head holds unchanged are given up, the others stay', () => {
        const current = hashes('a b c d');
        const head = hashes('a b X d');
        expect(dropCommitted([run(1, 2), run(3, 3)], current, head).map((entry) => [entry.start, entry.end])).toEqual([[3, 3]]);
    });

    test('a run half in the commit keeps the lines that are not', () => {
        const current = hashes('a b c d');
        const head = hashes('a b');
        expect(dropCommitted([run(1, 4)], current, head).map((entry) => [entry.start, entry.end])).toEqual([[3, 4]]);
    });

    test('a file git does not hold keeps every run', () => {
        expect(dropCommitted([run(1, 2)], hashes('a b'), null)).toHaveLength(1);
    });

    test('a removal git still has is open until the commit has it too', () => {
        const removal = run(3, 2);
        expect(dropCommitted([removal], hashes('a b d'), hashes('a b c d'))).toHaveLength(1);
        expect(dropCommitted([removal], hashes('a b d'), hashes('a b d'))).toEqual([]);
    });
});

describe('writtenHunks', () => {
    const edit = (added: string[], removed: string[]): WriteSignature => ({ all: false, blocks: [{ added, removed }] });
    const previous = 'a b c d e f';

    test('only the hunk the tool call explains counts', () => {
        const next = 'a B c d e F';
        const found = writtenHunks(hashes(previous), lines(previous), hashes(next), lines(next), edit(['B'], ['b']));
        expect(found.map((hunk) => [hunk.start, hunk.end])).toEqual([[1, 2]]);
    });

    test('a removal is found by the lines it took out', () => {
        const next = 'a b d e f';
        const found = writtenHunks(hashes(previous), lines(previous), hashes(next), lines(next), edit([], ['c']));
        expect(found.map((hunk) => [hunk.start, hunk.end, hunk.baseStart, hunk.baseEnd])).toEqual([[2, 2, 2, 3]]);
    });

    test("a change right next to the tool call's lines is cut off the hunk", () => {
        const next = 'a X B d e f';
        const found = writtenHunks(hashes(previous), lines(previous), hashes(next), lines(next), edit(['B'], ['b']));
        expect(found.map((hunk) => [hunk.start, hunk.end, hunk.trimmed])).toEqual([[2, 3, true]]);
    });

    test('a whole-file write owns every hunk', () => {
        const next = 'A b c d e F';
        expect(writtenHunks(hashes(previous), lines(previous), hashes(next), lines(next), { all: true, blocks: [] })).toHaveLength(2);
    });

    test('blank lines alone do not claim a hunk that something else explains', () => {
        const before = ['a', 'b', 'c', 'd', 'e'];
        const after = ['a', 'B', 'c', 'd', 'e', '', 'x'];
        const found = writtenHunks(hashes(before.join(' ')), before, hashLines(after), after, edit(['B', ''], ['b']));
        expect(found.map((hunk) => [hunk.start, hunk.end])).toEqual([[1, 2]]);
    });

    test('a hunk of blank lines only counts when nothing else matched', () => {
        const before = ['a', 'b'];
        const after = ['a', '', 'b'];
        const found = writtenHunks(hashLines(before), before, hashLines(after), after, edit(['a', '', 'b'], ['a', 'b']));
        expect(found.map((hunk) => [hunk.start, hunk.end])).toEqual([[1, 2]]);
    });
});

describe('locatedHunks', () => {
    test('an edit is where its added lines stand, a whole write is the file', () => {
        expect(locatedHunks(hashes('a b c d'), { all: false, blocks: [{ added: ['b', 'c'], removed: ['x'] }] })).toEqual([
            { start: 1, end: 3, baseStart: 0, baseEnd: 0 }
        ]);
        expect(locatedHunks(hashes('a b'), { all: true, blocks: [] })).toEqual([{ start: 0, end: 2, baseStart: 0, baseEnd: 0 }]);
        expect(locatedHunks(hashes('a b'), { all: false, blocks: [{ added: [], removed: ['a'] }] })).toEqual([]);
    });
});

describe('ranges and bounds', () => {
    test('what a run already covers is left out of a new one', () => {
        expect(uncoveredRanges(0, 6, [run(2, 3)])).toEqual([
            [0, 1],
            [3, 6]
        ]);
    });

    test('what a run keeps of replaced lines has a bound', () => {
        expect(boundedBefore(['a'])).toEqual(['a']);
        expect(boundedBefore([])).toBeUndefined();
        expect(boundedBefore(Array.from({ length: 201 }, () => 'x'))).toBeUndefined();
        expect(boundedBefore(['x'.repeat(17 * 1024)])).toBeUndefined();
    });
});
