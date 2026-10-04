import { describe, expect, it } from 'bun:test';
import { DocumentModel } from './document.ts';

const heads = (model: DocumentModel): number[] => model.getSelections().map((selection) => selection.head);

describe('select next occurrence', () => {
    const text = 'foo foobar foo Foo foo';

    it('selects the word at the caret first, then the next whole words with the same case', () => {
        const model = new DocumentModel(text);
        model.setSelections([{ anchor: 1, head: 1 }]);
        model.execute('selectNextOccurrence');
        expect(model.getSelections()).toEqual([{ anchor: 0, head: 3 }]);
        model.execute('selectNextOccurrence');
        expect(model.getSelections()).toEqual([
            { anchor: 0, head: 3 },
            { anchor: 11, head: 14 }
        ]);
        model.execute('selectNextOccurrence');
        expect(model.getPrimary()).toEqual({ anchor: 19, head: 22 });
    });

    it('stops at the end, says so, and goes round on the next press', () => {
        const model = new DocumentModel(text);
        model.setSelections([{ anchor: 19, head: 22 }]);
        expect(model.execute('selectNextOccurrence')).toBe(false);
        expect(model.occurrencesExhausted).toBe(true);
        expect(model.getSelections()).toHaveLength(1);
        model.execute('selectNextOccurrence');
        expect(model.getSelections()).toHaveLength(2);
        expect(model.getPrimary()).toEqual({ anchor: 0, head: 3 });
        expect(model.occurrencesExhausted).toBe(false);
    });

    it('finds the text inside other words when it began from a selection and not from the caret', () => {
        const model = new DocumentModel(text);
        model.setSelections([{ anchor: 0, head: 3 }]);
        model.execute('selectNextOccurrence');
        expect(model.getPrimary()).toEqual({ anchor: 4, head: 7 });
    });

    it('starts over as a word when something else moved the selection in between', () => {
        const model = new DocumentModel(text);
        model.setSelections([{ anchor: 1, head: 1 }]);
        model.execute('selectNextOccurrence');
        model.setSelections([{ anchor: 0, head: 3 }]);
        model.execute('selectNextOccurrence');
        expect(model.getPrimary()).toEqual({ anchor: 4, head: 7 });
    });

    it('keeps the caret at the same place in each occurrence', () => {
        const model = new DocumentModel('ab ab ab');
        model.setSelections([{ anchor: 2, head: 0 }]);
        model.execute('selectNextOccurrence');
        expect(model.getSelections()).toEqual([
            { anchor: 2, head: 0 },
            { anchor: 5, head: 3 }
        ]);
    });
});

describe('unselect the last occurrence', () => {
    it('takes the newest caret away and then the selection', () => {
        const model = new DocumentModel('ab ab ab');
        model.setSelections([{ anchor: 0, head: 2 }]);
        model.execute('selectNextOccurrence');
        model.execute('selectNextOccurrence');
        expect(model.getSelections()).toHaveLength(3);
        model.execute('unselectOccurrence');
        expect(heads(model)).toEqual([2, 5]);
        model.execute('unselectOccurrence');
        model.execute('unselectOccurrence');
        expect(model.getSelections()).toEqual([{ anchor: 2, head: 2 }]);
    });
});

describe('select all occurrences', () => {
    it('takes the whole words of the word at the caret', () => {
        const model = new DocumentModel('foo foobar foo');
        model.setSelections([{ anchor: 1, head: 1 }]);
        model.execute('selectAllOccurrences');
        expect(model.getSelections()).toEqual([
            { anchor: 0, head: 3 },
            { anchor: 11, head: 14 }
        ]);
    });

    it('takes every occurrence of a selection, the last one primary', () => {
        const model = new DocumentModel('foo foobar foo');
        model.setSelections([{ anchor: 0, head: 3 }]);
        model.execute('selectAllOccurrences');
        expect(model.getSelections()).toHaveLength(3);
        expect(model.getPrimary()).toEqual({ anchor: 11, head: 14 });
    });

    it('does nothing at a caret that is not in a word', () => {
        const model = new DocumentModel('a  b');
        model.setSelections([{ anchor: 2, head: 2 }]);
        expect(model.execute('selectAllOccurrences')).toBe(false);
    });
});

describe('add a caret per selected line', () => {
    const text = 'abc\ndef\nghi';

    it('puts a caret at the end of each line of the selection', () => {
        const model = new DocumentModel(text);
        model.setSelections([{ anchor: 1, head: 9 }]);
        model.execute('addCaretPerSelectedLine');
        expect(heads(model)).toEqual([3, 7, 11]);
        expect(model.getPrimary().head).toBe(11);
    });

    it('leaves out a last line the selection only reaches the start of, and makes the first caret primary for a backward selection', () => {
        const model = new DocumentModel(text);
        model.setSelections([{ anchor: 8, head: 1 }]);
        model.execute('addCaretPerSelectedLine');
        expect(heads(model)).toEqual([7, 3]);
        const lines = new DocumentModel(text);
        lines.setSelections([{ anchor: 0, head: 8 }]);
        lines.execute('addCaretPerSelectedLine');
        expect(heads(lines)).toEqual([3, 7]);
    });

    it('moves a bare caret to the end of its line', () => {
        const model = new DocumentModel(text);
        model.setSelections([{ anchor: 5, head: 5 }]);
        model.execute('addCaretPerSelectedLine');
        expect(model.getSelections()).toEqual([{ anchor: 7, head: 7 }]);
    });
});
