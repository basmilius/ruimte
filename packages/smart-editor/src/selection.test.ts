import { describe, expect, test } from 'bun:test';
import { mountEditor } from './testing.ts';

describe('setSelection', () => {
    test('selects a range with the caret at its end', () => {
        const { editor } = mountEditor({ text: 'let value = 1;\nlet other = 2;' });
        const heard: Array<{ line: number; character: number }> = [];
        editor.onCaret((position) => heard.push(position));
        editor.setSelection({ start: { line: 0, character: 4 }, end: { line: 0, character: 9 } });
        expect(editor.getSelection()).toEqual({ start: { line: 0, character: 4 }, end: { line: 0, character: 9 } });
        expect(editor.getCaret()).toEqual({ line: 0, character: 9 });
        expect(heard.at(-1)).toEqual({ line: 0, character: 9 });
        editor.dispose();
    });
});
