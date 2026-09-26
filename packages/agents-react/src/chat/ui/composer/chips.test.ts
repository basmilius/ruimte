import { describe, expect, test } from 'bun:test';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, type DecorationSet } from '@codemirror/view';
import { chipDecorations } from './chips';
import { markdownLanguage } from './editor';

const chipsOf = (state: EditorState): string[] => {
    const found: string[] = [];
    for (const source of state.facet(EditorView.decorations)) {
        (source as DecorationSet).between(0, state.doc.length, (from, to) => {
            found.push(state.doc.sliceString(from, to));
        });
    }
    return found;
};

describe('chipDecorations', () => {
    test('marks the chosen mentions and skills in the text', () => {
        const state = EditorState.create({ doc: 'run $unslop over @a.ts', extensions: chipDecorations({ mentions: ['a.ts'], skills: ['unslop'] }) });
        expect(chipsOf(state)).toEqual(['$unslop', '@a.ts']);
    });

    test('drops a chip an edit breaks and draws one an edit completes', () => {
        const state = EditorState.create({ doc: 'see @a.ts', extensions: chipDecorations({ mentions: ['a.ts'], skills: [] }) });
        const broken = state.update({ changes: { from: 8, to: 9 } }).state;
        expect(broken.doc.toString()).toBe('see @a.t');
        expect(chipsOf(broken)).toEqual([]);
        const mended = broken.update({ changes: { from: 8, insert: 's' } }).state;
        expect(chipsOf(mended)).toEqual(['@a.ts']);
    });

    test('leaves a token inside a code span or a fence as text', () => {
        const doc = 'see `@a.ts` and @a.ts\n```\n@a.ts\n```';
        const state = EditorState.create({ doc, extensions: [markdownLanguage, chipDecorations({ mentions: ['a.ts'], skills: [] })] });
        const ranges: number[] = [];
        for (const source of state.facet(EditorView.decorations)) {
            (source as DecorationSet).between(0, state.doc.length, (from) => {
                ranges.push(from);
            });
        }
        expect(ranges).toEqual([16]);
    });

    test('redraws when the choices change without an edit', () => {
        const slot = new Compartment();
        const state = EditorState.create({ doc: '@a.ts and @b.ts', extensions: slot.of(chipDecorations({ mentions: ['a.ts'], skills: [] })) });
        expect(chipsOf(state)).toEqual(['@a.ts']);
        const next = state.update({ effects: slot.reconfigure(chipDecorations({ mentions: ['a.ts', 'b.ts'], skills: [] })) }).state;
        expect(chipsOf(next)).toEqual(['@a.ts', '@b.ts']);
    });
});
