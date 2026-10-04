import { describe, expect, it } from 'bun:test';
import { DocumentModel } from './document.ts';

function walk(text: string, start: number, command: 'wordLeft' | 'wordRight', steps: number): number[] {
    const model = new DocumentModel(text);
    model.setSelections([{ anchor: start, head: start }]);
    const stops: number[] = [];
    for (let i = 0; i < steps; i++) {
        model.execute(command);
        stops.push(model.getPrimary().head);
    }
    return stops;
}

describe('word movement and line breaks', () => {
    it('goes forward to the end of a word, then the start of the next line, and stops on an empty line', () => {
        expect(walk('foo bar\n\nbaz', 0, 'wordRight', 7)).toEqual([3, 7, 8, 9, 12, 12, 12]);
    });

    it('goes backward to the start of a word, then the end of the line above', () => {
        expect(walk('foo bar\n\nbaz', 12, 'wordLeft', 6)).toEqual([9, 8, 7, 4, 0, 0]);
    });

    it('skips the whitespace at the end of a line on its way to the next line', () => {
        expect(walk('foo  \nbar', 3, 'wordRight', 3)).toEqual([6, 9, 9]);
    });

    it('skips the indentation on its way back to the line above', () => {
        expect(walk('ab\n  cd', 7, 'wordLeft', 3)).toEqual([5, 2, 0]);
    });

    it('treats a CRLF as one stop', () => {
        expect(walk('ab\r\ncd', 0, 'wordRight', 3)).toEqual([2, 4, 6]);
        expect(walk('ab\r\ncd', 6, 'wordLeft', 3)).toEqual([4, 2, 0]);
    });

    it('keeps the camel humps off until the setting turns them on', () => {
        const model = new DocumentModel('fooBar');
        model.execute('wordRight');
        expect(model.getPrimary().head).toBe(6);
        model.setSelections([{ anchor: 0, head: 0 }]);
        model.execute('wordRight', { camelCase: true });
        expect(model.getPrimary().head).toBe(3);
    });

    it('moves the caret from its head when a selection is there, and a select command keeps the anchor', () => {
        const model = new DocumentModel('one two three');
        model.setSelections([{ anchor: 0, head: 3 }]);
        model.execute('wordRight');
        expect(model.getSelections()).toEqual([{ anchor: 7, head: 7 }]);
        model.setSelections([{ anchor: 4, head: 4 }]);
        model.execute('selectWordRight');
        expect(model.getSelections()).toEqual([{ anchor: 4, head: 7 }]);
    });
});

describe('deleting by word', () => {
    it('stops at both edges of a word and of the whitespace between them', () => {
        const model = new DocumentModel('foo   bar');
        model.execute('deleteWordRight');
        expect(model.getText()).toBe('   bar');
        model.execute('deleteWordRight');
        expect(model.getText()).toBe('bar');
    });

    it('takes only the line break at the end of a line, and at the start of one', () => {
        const forward = new DocumentModel('ab\ncd');
        forward.setSelections([{ anchor: 2, head: 2 }]);
        forward.execute('deleteWordRight');
        expect(forward.getText()).toBe('abcd');
        const backward = new DocumentModel('ab\ncd');
        backward.setSelections([{ anchor: 3, head: 3 }]);
        backward.execute('deleteWordLeft');
        expect(backward.getText()).toBe('abcd');
    });

    it('stays on its line when the word is further back', () => {
        const model = new DocumentModel('one\n  two');
        model.setSelections([{ anchor: 9, head: 9 }]);
        model.execute('deleteWordLeft');
        expect(model.getText()).toBe('one\n  ');
        model.execute('deleteWordLeft');
        expect(model.getText()).toBe('one\n');
    });
});
