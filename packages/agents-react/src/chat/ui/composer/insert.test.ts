import { describe, expect, test } from 'bun:test';
import { EditorSelection, EditorState } from '@codemirror/state';
import { insertAtSelection } from './insert';

const typed = (doc: string, from: number, to: number, text: string): { doc: string; caret: number } => {
    const state = EditorState.create({ doc, selection: EditorSelection.single(from, to) });
    const next = state.update(insertAtSelection(state, text)).state;
    return { doc: next.doc.toString(), caret: next.selection.main.head };
};

describe('insertAtSelection', () => {
    test('an empty draft takes the text with a space to type on after', () => {
        expect(typed('', 0, 0, 'at 0:12')).toEqual({ doc: 'at 0:12 ', caret: 8 });
    });

    test('text after a word keeps a space from it', () => {
        expect(typed('look', 4, 4, 'at 0:12')).toEqual({ doc: 'look at 0:12 ', caret: 13 });
    });

    test('text between spaces adds none of its own', () => {
        expect(typed('look  here', 5, 5, 'at 0:12')).toEqual({ doc: 'look at 0:12 here', caret: 12 });
    });

    test('text before a word keeps a space from it', () => {
        expect(typed('here', 0, 0, 'at 0:12')).toEqual({ doc: 'at 0:12 here', caret: 8 });
    });

    test('a selection is replaced', () => {
        expect(typed('look there now', 5, 10, 'at 0:12')).toEqual({ doc: 'look at 0:12 now', caret: 12 });
    });

    test('nothing to insert changes nothing', () => {
        expect(typed('look', 4, 4, '')).toEqual({ doc: 'look', caret: 4 });
    });
});
