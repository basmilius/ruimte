import { describe, expect, it } from 'bun:test';
import { DocumentModel } from './document.ts';

const heads = (model: DocumentModel): number[] => model.getSelections().map((selection) => selection.head);

describe('adding a caret above or below', () => {
    const text = 'abcdef\nabcdef\nabcdef\nabcdef';

    it('adds one on the line below and again below that, the newest primary', () => {
        const model = new DocumentModel(text);
        model.setSelections([{ anchor: 2, head: 2 }]);
        model.execute('addCaretBelow');
        model.execute('addCaretBelow');
        expect(heads(model)).toEqual([2, 9, 16]);
        expect(model.getPrimary().head).toBe(16);
    });

    it('takes back the carets it added when pressed the other way, a step at a time, then adds above', () => {
        const model = new DocumentModel(text);
        model.setSelections([{ anchor: 9, head: 9 }]);
        model.execute('addCaretBelow');
        model.execute('addCaretBelow');
        expect(heads(model)).toEqual([9, 16, 23]);
        model.execute('addCaretAbove');
        expect(heads(model)).toEqual([9, 16]);
        model.execute('addCaretAbove');
        expect(heads(model)).toEqual([9]);
        model.execute('addCaretAbove');
        expect(heads(model)).toEqual([9, 2]);
    });

    it('does not take anything back once something else moved the carets', () => {
        const model = new DocumentModel(text);
        model.setSelections([{ anchor: 9, head: 9 }]);
        model.execute('addCaretBelow');
        model.setSelections([
            { anchor: 9, head: 9 },
            { anchor: 16, head: 16 }
        ]);
        model.execute('addCaretAbove');
        expect(heads(model)).toEqual([9, 16, 2]);
    });

    it('clones every caret, and keeps the column across a line that is too short', () => {
        const model = new DocumentModel('abcdef\nab\nabcdef');
        model.setSelections([{ anchor: 5, head: 5 }]);
        model.execute('addCaretBelow');
        expect(heads(model)).toEqual([5, 9]);
        model.execute('addCaretBelow');
        expect(heads(model)).toEqual([5, 9, 15]);
    });

    it('clones a selection, and skips a line that cannot hold it', () => {
        const model = new DocumentModel('abcdef\nab\nabcdef');
        model.setSelections([{ anchor: 3, head: 5 }]);
        model.execute('addCaretBelow');
        expect(model.getSelections()).toEqual([
            { anchor: 3, head: 5 },
            { anchor: 13, head: 15 }
        ]);
    });

    it('stops at the ends of the text and where a caret already is', () => {
        const model = new DocumentModel('ab\ncd');
        model.setSelections([{ anchor: 4, head: 4 }]);
        expect(model.execute('addCaretBelow')).toBe(false);
        model.setSelections([
            { anchor: 1, head: 1 },
            { anchor: 4, head: 4 }
        ]);
        expect(model.execute('addCaretBelow')).toBe(false);
        expect(heads(model)).toEqual([1, 4]);
    });
});
