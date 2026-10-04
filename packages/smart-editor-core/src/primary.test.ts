import { describe, expect, it } from 'bun:test';
import { DocumentModel } from './document.ts';

describe('the primary caret', () => {
    it('is the caret added last', () => {
        const model = new DocumentModel('one\ntwo\nthree');
        model.setSelections([{ anchor: 1, head: 1 }]);
        model.execute('addCaretBelow');
        expect(model.getSelections()).toEqual([
            { anchor: 1, head: 1 },
            { anchor: 5, head: 5 }
        ]);
        expect(model.getPrimary()).toEqual({ anchor: 5, head: 5 });
        model.execute('addCaretBelow');
        expect(model.getPrimary()).toEqual({ anchor: 9, head: 9 });
    });

    it('is the occurrence just selected', () => {
        const model = new DocumentModel('foo bar foo');
        model.setSelections([{ anchor: 0, head: 3 }]);
        model.execute('selectNextOccurrence');
        expect(model.getPrimary()).toEqual({ anchor: 8, head: 11 });
    });

    it('stays last when another selection merges into one of the others', () => {
        const model = new DocumentModel('abcdefghij');
        model.setSelections([
            { anchor: 0, head: 2 },
            { anchor: 6, head: 8 },
            { anchor: 1, head: 4 }
        ]);
        expect(model.getSelections()).toEqual([
            { anchor: 6, head: 8 },
            { anchor: 0, head: 4 }
        ]);
        expect(model.getPrimary()).toEqual({ anchor: 0, head: 4 });
    });

    it('follows an edit that moves it', () => {
        const model = new DocumentModel('ab\ncd');
        model.setSelections([
            { anchor: 4, head: 4 },
            { anchor: 1, head: 1 }
        ]);
        model.applyEdits([{ from: 0, to: 0, text: 'xx' }]);
        expect(model.getPrimary()).toEqual({ anchor: 3, head: 3 });
    });
});
