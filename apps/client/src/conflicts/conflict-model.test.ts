import { describe, expect, test } from 'bun:test';
import type { GitConflictResult } from '@ruimte/contracts';
import { fingerprint, splitBlocks, splitLines } from '@ruimte/merge';
import { conflictIndexes, contentOf, draftWith, fileOf, nextConflict, openInDraft, usableBlocks } from '@/conflicts/conflict-model';

const answer = (patch: Partial<GitConflictResult> = {}): GitConflictResult => ({
    path: 'file.txt',
    kind: 'text',
    base: 'one\ntwo\nthree\n',
    ours: 'one\nour two\nthree\n',
    theirs: 'one\ntheir two\nthree\n',
    hash: 'abc',
    ...patch
});

describe('fileOf', () => {
    test('opens on the merged draft with our side in the conflict', () => {
        const file = fileOf(answer());
        expect(file.text).toBe('one\nour two\nthree');
        expect(conflictIndexes(file)).toEqual([1]);
        expect(file.whole).toBe(false);
    });

    test('a file that is not text is a choice between whole sides', () => {
        const file = fileOf(answer({ kind: 'binary', base: null, ours: null, theirs: null, omitted: 'binary' }));
        expect(file.whole).toBe(true);
        expect(file.blocks).toEqual([]);
    });

    test('a file one side deleted is a whole choice as well', () => {
        expect(fileOf(answer({ kind: 'deleted-by-them', theirs: null })).whole).toBe(true);
    });
});

describe('contentOf', () => {
    test('writes the file back in the line ending it had', () => {
        const file = fileOf(answer({ ours: 'one\r\ntwo\r\n', base: 'one\r\ntwo\r\n', theirs: 'one\r\ntwo\r\n' }));
        expect(contentOf(file, 'one\ntwo')).toBe('one\r\ntwo\r\n');
    });

    test('a file that ended without a newline keeps ending without one', () => {
        const file = fileOf(answer({ ours: 'one\ntwo', base: 'one\ntwo', theirs: 'one\ntwo' }));
        expect(contentOf(file, 'one\ntwo')).toBe('one\ntwo');
    });
});

describe('draftWith', () => {
    test('puts an answer in a file nobody has open and marks it settled', () => {
        const file = fileOf(answer());
        const draft = draftWith(file, new Map([[1, ['merged two']]]));
        expect(draft.text).toBe('one\nmerged two\nthree');
        expect(openInDraft(draft)).toEqual([]);
        const span = draft.spans.find((entry) => entry.block === 1)!;
        expect(draft.text.slice(span.from, span.to)).toBe('merged two\n');
    });

    test('a file nobody answered still counts its conflicts', () => {
        expect(openInDraft(draftWith(fileOf(answer()), new Map()))).toEqual([1]);
    });
});

describe('usableBlocks', () => {
    const file = fileOf(answer());
    const real = fingerprint(file.blocks[1]!);

    test('takes the proposals written for the stretch that is there', () => {
        expect(usableBlocks(file, [{ index: 1, fingerprint: real, lines: ['merged'] }])).toEqual([{ index: 1, lines: ['merged'] }]);
    });

    test('drops a proposal written for another version of the file', () => {
        expect(usableBlocks(file, [{ index: 1, fingerprint: 'deadbeef', lines: ['merged'] }])).toEqual([]);
    });

    test('drops a proposal for a stretch that never conflicted', () => {
        expect(usableBlocks(file, [{ index: 0, fingerprint: fingerprint(file.blocks[0]!), lines: ['merged'] }])).toEqual([]);
    });
});

describe('nextConflict', () => {
    const blocks = splitBlocks(splitLines('a\nb\nc\nd\ne\n'), splitLines('ours a\nb\nc\nd\nours e\n'), splitLines('theirs a\nb\nc\nd\ntheirs e\n'));
    const indexes = blocks.flatMap((block, index) => (block.kind === 'conflict' ? [index] : []));

    test('walks forward and wraps around', () => {
        expect(indexes.length).toBe(2);
        expect(nextConflict(indexes, null, 1)).toBe(indexes[0]!);
        expect(nextConflict(indexes, indexes[0]!, 1)).toBe(indexes[1]!);
        expect(nextConflict(indexes, indexes[1]!, 1)).toBe(indexes[0]!);
    });

    test('walks back the same way', () => {
        expect(nextConflict(indexes, indexes[0]!, -1)).toBe(indexes[1]!);
        expect(nextConflict([], null, 1)).toBeNull();
    });
});
