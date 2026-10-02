import { describe, expect, test } from 'bun:test';
import type { GitConflictResult } from '@ruimte/contracts';
import { fingerprint, splitBlocks, splitLines } from '@ruimte/merge';
import {
    answerInto,
    carryDraft,
    conflictIndexes,
    contentOf,
    draftWith,
    fileOf,
    nextConflict,
    openInDraft,
    usableBlocks,
    writeConflict,
    type ConflictFile
} from '@/conflicts/conflict-model';
import type { ConflictDraft } from '@/conflicts/editor';

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

describe('answerInto', () => {
    const twice = (): ConflictFile => fileOf(answer({ base: 'a\nb\nc\nd\ne\n', ours: 'ours a\nb\nc\nd\nours e\n', theirs: 'theirs a\nb\nc\nd\ntheirs e\n' }));
    const textOf = (draft: ConflictDraft, block: number): string => {
        const span = draft.spans.find((entry) => entry.block === block)!;
        return draft.text.slice(span.from, span.to);
    };

    test('a file never opened takes the answers into its merged draft', () => {
        const file = fileOf(answer());
        expect(answerInto(undefined, file, new Map([[1, ['merged two']]]))).toEqual(draftWith(file, new Map([[1, ['merged two']]])));
    });

    test('a stretch a person already answered keeps their words, and the open one after a longer answer still lines up', () => {
        const file = twice();
        const [first, last] = conflictIndexes(file) as [number, number];
        const handWork = answerInto(undefined, file, new Map([[last, ['my own e']]]));

        const next = answerInto(
            handWork,
            file,
            new Map([
                [first, ['agent a', 'and more']],
                [last, ['agent e']]
            ])
        );

        expect(next.text).toBe('agent a\nand more\nb\nc\nd\nmy own e');
        expect(textOf(next, first)).toBe('agent a\nand more\n');
        expect(textOf(next, last)).toBe('my own e');
        expect(openInDraft(next)).toEqual([]);
    });

    test('emptying the last stretch leaves no blank line behind', () => {
        const file = fileOf(answer({ base: 'a\nb\nc\n', ours: 'a\nb\nOURS\n', theirs: 'a\nb\n' }));
        const [last] = conflictIndexes(file) as [number];
        const draft = answerInto(undefined, file, new Map([[last, []]]));
        expect(contentOf(file, draft.text)).toBe('a\nb\n');
        expect(draft.spans.every((span) => span.to <= draft.text.length)).toBe(true);
        const refilled = answerInto({ ...draft, spans: draft.spans.map((span) => ({ ...span, settled: false })) }, file, new Map([[last, ['OURS']]]));
        expect(contentOf(file, refilled.text)).toBe('a\nb\nOURS\n');
    });

    test('an answer for a stretch that is not a conflict changes nothing', () => {
        const file = fileOf(answer());
        const draft = draftWith(file, new Map());
        expect(answerInto(draft, file, new Map([[0, ['no']]]))).toEqual(draft);
    });
});

describe('a file that starts with a byte order mark', () => {
    test('keeps it in the editor and in what is written back', () => {
        const file = fileOf(answer({ base: '﻿one\ntwo\n', ours: '﻿one\nour two\n', theirs: '﻿one\ntheir two\n' }));
        expect(file.text.startsWith('﻿')).toBe(true);
        expect(contentOf(file, file.text)).toBe('﻿one\nour two\n');
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

describe('a file that moved on disk while it was resolved', () => {
    test('the first write refuses, and the next one writes over what stands there now with the work kept', async () => {
        const file = fileOf(answer());
        const cache = { files: new Map([[file.path, file]]), drafts: new Map([[file.path, answerInto(undefined, file, new Map([[1, ['merged two']]]))]]) };
        // Read at `abc`; a save in an editor moved it to `def` before the person pressed Resolve.
        const onDisk = 'def';
        const written: { content: string; hash: string }[] = [];
        const writer = {
            resolve: async (path: string, content: string, hash: string): Promise<void> => {
                if (hash !== onDisk) {
                    throw new Error(`${path} changed on disk while it was being resolved.`);
                }
                written.push({ content, hash });
            },
            read: async (): Promise<GitConflictResult> => answer({ hash: onDisk })
        };

        await expect(writeConflict(cache, file.path, writer)).rejects.toThrow('changed on disk');
        expect(cache.files.get(file.path)?.hash).toBe('def');
        expect(cache.drafts.get(file.path)?.text).toBe('one\nmerged two\nthree');

        await writeConflict(cache, file.path, writer);
        expect(written).toEqual([{ content: 'one\nmerged two\nthree\n', hash: 'def' }]);
        expect(cache.files.has(file.path)).toBe(false);
        expect(cache.drafts.has(file.path)).toBe(false);
    });

    test('an answer comes along to new versions only while its stretch is the same one', () => {
        const before = fileOf(answer({ base: 'a\nb\nc\nd\ne\n', ours: 'ours a\nb\nc\nd\nours e\n', theirs: 'theirs a\nb\nc\nd\ntheirs e\n' }));
        const [first, last] = conflictIndexes(before) as [number, number];
        const draft = answerInto(
            undefined,
            before,
            new Map([
                [first, ['merged a']],
                [last, ['merged e']]
            ])
        );
        const after = fileOf(answer({ base: 'a\nb\nc\nd\ne\n', ours: 'ours a\nb\nc\nd\nother e\n', theirs: 'theirs a\nb\nc\nd\ntheirs e\n', hash: 'def' }));

        const carried = carryDraft(before, after, draft);
        expect(carried.text).toBe('merged a\nb\nc\nd\nother e');
        expect(openInDraft(carried)).toEqual([last]);
        expect(
            carryDraft(
                before,
                fileOf(answer({ base: 'a\nb\nc\nd\ne\n', ours: 'ours a\nb\nc\nd\nours e\n', theirs: 'theirs a\nb\nc\nd\ntheirs e\n', hash: 'def' })),
                draft
            )
        ).toBe(draft);
    });
});
