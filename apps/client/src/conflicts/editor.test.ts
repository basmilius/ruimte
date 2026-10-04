import { describe, expect, test } from 'bun:test';
import { EditorState } from '@codemirror/state';
import type { GitConflictResult } from '@ruimte/contracts';
import { contentOf, fileOf } from '@/conflicts/conflict-model';
import { blockChange, conflictEditing, setSpans, spansField, spansOf } from '@/conflicts/editor';

function answer(patch: Partial<GitConflictResult> = {}): GitConflictResult {
    return {
        path: 'file.txt',
        kind: 'text',
        base: 'one\ntwo\nthree\n',
        ours: 'one\nour two\nthree\n',
        theirs: 'one\ntheir two\nthree\n',
        hash: 'abc',
        ...patch
    };
}

/* The editor's state as the overlay opens it, with the spans set the way the component sets them. */
function opened(patch: Partial<GitConflictResult>): { state: EditorState; file: ReturnType<typeof fileOf> } {
    const file = fileOf(answer(patch));
    const created = EditorState.create({ doc: file.text, extensions: [conflictEditing] });
    const state = created.update({ effects: setSpans.of(spansOf(created.doc, file.spans)) }).state;
    return { state, file };
}

describe('a lone carriage return inside a line', () => {
    const patch = { base: 'a\nx = "1\r2"\nb\nc\n', ours: 'a\nx = "1\r2"\nb\nOURS\n', theirs: 'a\nx = "1\r2"\nb\nTHEIRS\n' };

    test('is no line break, so the conflict span covers the conflict', () => {
        const { state } = opened(patch);
        const conflict = state.field(spansField).find((span) => span.kind === 'conflict')!;
        expect(state.doc.sliceString(conflict.from, conflict.to)).toBe('OURS');
    });

    test('is written back as it was', () => {
        const { state, file } = opened(patch);
        expect(contentOf(file, state.doc.toString())).toBe(patch.ours);
    });
});

describe('blockChange', () => {
    /* Every side a person can take for each conflict, and what the file then reads on disk. */
    const cases: { name: string; patch: Partial<GitConflictResult>; lines: string[]; written: string }[] = [
        { name: 'the empty side of the last stretch', patch: { base: 'a\nb\nc\n', ours: 'a\nb\nOURS\n', theirs: 'a\nb\n' }, lines: [], written: 'a\nb\n' },
        { name: 'the empty side of a middle stretch', patch: { base: 'a\nb\nc\n', ours: 'a\nOURS\nc\n', theirs: 'a\nc\n' }, lines: [], written: 'a\nc\n' },
        { name: 'the empty side of the only stretch', patch: { base: 'c\n', ours: 'OURS\n', theirs: '' }, lines: [], written: '' },
        {
            name: 'a full side where ours emptied the end',
            patch: { base: 'a\nb\nc\n', ours: 'a\nb\n', theirs: 'a\nb\nTHEIRS\n' },
            lines: ['THEIRS'],
            written: 'a\nb\nTHEIRS\n'
        },
        {
            name: 'the empty side where ours already emptied the end',
            patch: { base: 'a\nb\nc\n', ours: 'a\nb\n', theirs: 'a\nb\nTHEIRS\n' },
            lines: [],
            written: 'a\nb\n'
        }
    ];

    for (const entry of cases) {
        test(`taking ${entry.name} writes the file as chosen`, () => {
            const { state, file } = opened(entry.patch);
            const block = file.blocks.findIndex((candidate) => candidate.kind === 'conflict');
            const next = state.update(blockChange(state, block, entry.lines)!).state;
            expect(contentOf(file, next.doc.toString())).toBe(entry.written);
            expect(next.field(spansField).find((span) => span.block === block)!.settled).toBe(true);
        });
    }

    test('taking a side again after emptying the end puts the line back', () => {
        const { state, file } = opened({ base: 'a\nb\nc\n', ours: 'a\nb\nOURS\n', theirs: 'a\nb\n' });
        const block = file.blocks.findIndex((candidate) => candidate.kind === 'conflict');
        const emptied = state.update(blockChange(state, block, [])!).state;
        const refilled = emptied.update(blockChange(emptied, block, ['OURS'])!).state;
        expect(contentOf(file, refilled.doc.toString())).toBe('a\nb\nOURS\n');
    });
});
