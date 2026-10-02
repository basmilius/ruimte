import { describe, expect, test } from 'bun:test';
import { EditorState } from '@codemirror/state';
import type { GitConflictResult } from '@ruimte/contracts';
import { contentOf, fileOf } from '@/conflicts/conflict-model';
import { conflictEditing, setSpans, spansField, spansOf } from '@/conflicts/editor';

const answer = (patch: Partial<GitConflictResult> = {}): GitConflictResult => ({
    path: 'file.txt',
    kind: 'text',
    base: 'one\ntwo\nthree\n',
    ours: 'one\nour two\nthree\n',
    theirs: 'one\ntheir two\nthree\n',
    hash: 'abc',
    ...patch
});

/* The editor's state as the overlay opens it, with the spans set the way the component sets them. */
const opened = (patch: Partial<GitConflictResult>): { state: EditorState; file: ReturnType<typeof fileOf> } => {
    const file = fileOf(answer(patch));
    const created = EditorState.create({ doc: file.text, extensions: [conflictEditing] });
    const state = created.update({ effects: setSpans.of(spansOf(created.doc, file.spans)) }).state;
    return { state, file };
};

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
