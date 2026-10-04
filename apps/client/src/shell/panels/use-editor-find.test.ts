import { describe, expect, test } from 'bun:test';
import type { Editor, EditorRange } from '@ruimte/smart-editor';
import { EMPTY_FIND_QUERY } from '@/find/query';
import { seedFromSelection } from '@/shell/panels/use-editor-find';

function editorWith(text: string, range: EditorRange): Editor {
    const offset = (line: number, character: number): number => text.split('\n').slice(0, line).join('\n').length + (line > 0 ? 1 : 0) + character;
    return {
        getSelection: () => range,
        textInRange: (selected: EditorRange) =>
            text.slice(offset(selected.start.line, selected.start.character), offset(selected.end.line, selected.end.character))
    } as unknown as Editor;
}

const range = (startLine: number, startCharacter: number, endLine: number, endCharacter: number): EditorRange => ({
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter }
});

describe('seeding the find from the selection', () => {
    test('searches for the selected text', () => {
        const editor = editorWith('one two', range(0, 4, 0, 7));
        expect(seedFromSelection(editor, false, EMPTY_FIND_QUERY)).toEqual({ text: 'two', inSelection: false });
        expect(seedFromSelection(editor, true, EMPTY_FIND_QUERY)).toEqual({ text: 'two', inSelection: false });
    });

    test('escapes the text for a regular expression', () => {
        const editor = editorWith('a.b(c)', range(0, 0, 0, 6));
        expect(seedFromSelection(editor, false, { ...EMPTY_FIND_QUERY, regex: true })).toEqual({ text: 'a\\.b\\(c\\)', inSelection: false });
    });

    test('leaves the query alone without a selection', () => {
        expect(seedFromSelection(editorWith('one', range(0, 1, 0, 1)), false, EMPTY_FIND_QUERY)).toBeNull();
    });

    test('searches several selected lines for what was asked before, and replaces only inside them', () => {
        const editor = editorWith('one\ntwo\nthree', range(0, 0, 1, 3));
        expect(seedFromSelection(editor, false, EMPTY_FIND_QUERY)).toEqual({ text: 'one\ntwo', inSelection: false });
        expect(seedFromSelection(editor, true, { ...EMPTY_FIND_QUERY, text: 'wo' })).toEqual({ inSelection: true });
    });
});
