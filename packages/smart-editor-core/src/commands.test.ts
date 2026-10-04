import { describe, expect, it } from 'bun:test';
import { DocumentModel } from './document.ts';

function caret(model: DocumentModel, offset: number): void {
    model.setSelections([{ anchor: offset, head: offset }]);
}

describe('smart and camel movement', () => {
    it('toggles End and extends Home/End with CRLF, tabs and reversed selections', () => {
        const model = new DocumentModel('\t  hello  \r\nnext');
        caret(model, 6);
        model.execute('selectSmartEnd');
        expect(model.getSelections()).toEqual([{ anchor: 6, head: 8 }]);
        model.execute('selectSmartEnd');
        expect(model.getSelections()).toEqual([{ anchor: 6, head: 10 }]);
        model.execute('selectSmartHome');
        expect(model.getSelections()).toEqual([{ anchor: 6, head: 3 }]);
        model.execute('selectSmartHome');
        expect(model.getSelections()).toEqual([{ anchor: 6, head: 0 }]);
        model.execute('smartEnd');
        expect(model.getSelections()).toEqual([{ anchor: 8, head: 8 }]);
        model.execute('smartEnd');
        expect(model.getSelections()).toEqual([{ anchor: 10, head: 10 }]);
        expect(model.getRevision()).toBe(0);
    });

    it('separates ordinary word movement from explicit camel commands', () => {
        const model = new DocumentModel('fooBar XMLParser snake_case');
        model.execute('wordRight', { camelCase: false });
        expect(model.getSelections()[0]!.head).toBe(6);
        model.execute('camelLeft', { camelCase: false });
        expect(model.getSelections()[0]!.head).toBe(3);
        model.execute('selectCamelRight', { camelCase: false });
        expect(model.getSelections()).toEqual([{ anchor: 3, head: 6 }]);
        model.execute('deleteCamelLeft');
        expect(model.getText()).toBe('foo XMLParser snake_case');
        model.undo();
        caret(model, 0);
        model.execute('deleteWordRight', { camelCase: false });
        expect(model.getText()).toBe(' XMLParser snake_case');
        model.undo();
        caret(model, 0);
        model.execute('deleteCamelRight', { camelCase: false });
        expect(model.getText()).toBe('Bar XMLParser snake_case');
    });

    it('never stops inside a CRLF or surrogate pair when moving or selecting', () => {
        const model = new DocumentModel('a😀\r\nb');
        caret(model, 4);
        expect(model.getSelections()[0]!.head).toBe(3);
        for (let i = 0; i < 8; i++) {
            model.execute('wordRight');
            expect([2, 4]).not.toContain(model.getSelections()[0]!.head);
        }
        for (let i = 0; i < 8; i++) {
            model.execute('selectWordLeft');
            expect([2, 4]).not.toContain(model.getSelections()[0]!.head);
        }
    });
});

describe('pairing, smart deletion and newline', () => {
    it('pairs brackets, types inside them, skips a closer and undoes text separately from cursor moves', () => {
        const model = new DocumentModel();
        expect(model.typeText('(')).toBe(true);
        expect(model.getText()).toBe('()');
        expect(model.getSelections()[0]!.head).toBe(1);
        model.typeText('x');
        expect(model.getText()).toBe('(x)');
        const revision = model.getRevision();
        expect(model.typeText(')')).toBe(true);
        expect(model.getSelections()[0]!.head).toBe(3);
        expect(model.getRevision()).toBe(revision);
        model.undo();
        expect(model.getText()).toBe('');
        model.redo();
        expect(model.getText()).toBe('(x)');
        expect(model.getSelections()[0]!.head).toBe(2);
    });

    it('wraps multiple directional selections and preserves their contents through history', () => {
        const model = new DocumentModel('one 😀two');
        model.setSelections([
            { anchor: 3, head: 0 },
            { anchor: 4, head: 9 }
        ]);
        model.typeText('[');
        expect(model.getText()).toBe('[one] [😀two]');
        expect(model.getSelections()).toEqual([
            { anchor: 4, head: 1 },
            { anchor: 7, head: 12 }
        ]);
        model.undo();
        expect(model.getSelections()).toEqual([
            { anchor: 3, head: 0 },
            { anchor: 4, head: 9 }
        ]);
        model.redo();
        expect(model.getText()).toBe('[one] [😀two]');
    });

    it('maps a skipped closer alongside a second caret inserting a pair', () => {
        const model = new DocumentModel('"" \n');
        model.setSelections([
            { anchor: 1, head: 1 },
            { anchor: 4, head: 4 }
        ]);
        model.typeText('"');
        expect(model.getText()).toBe('"" \n""');
        expect(model.getSelections()).toEqual([
            { anchor: 2, head: 2 },
            { anchor: 5, head: 5 }
        ]);
    });

    it('honors disabled pairing, stale revisions, escaped quotes and identifier adjacency', () => {
        const model = new DocumentModel();
        model.typeText('(', { autoClosingPairs: false });
        expect(model.getText()).toBe('(');
        expect(model.typeText('[', { expectedRevision: 0 })).toBe(false);
        model.setText('abc');
        caret(model, 3);
        model.typeText("'");
        expect(model.getText()).toBe("abc'");
        model.setText('\\');
        caret(model, 1);
        model.typeText('"');
        expect(model.getText()).toBe('\\"');
        model.setText('word');
        caret(model, 0);
        model.typeText('(');
        expect(model.getText()).toBe('(word');
    });

    it('deletes an empty pair or a full Unicode scalar/CRLF and restores all of them', () => {
        const model = new DocumentModel('()😀\r\nx');
        caret(model, 1);
        model.execute('smartBackspace');
        expect(model.getText()).toBe('😀\r\nx');
        caret(model, 2);
        model.execute('smartBackspace');
        expect(model.getText()).toBe('\r\nx');
        caret(model, 2);
        model.execute('smartBackspace');
        expect(model.getText()).toBe('x');
        model.undo();
        expect(model.getText()).toBe('\r\nx');
        caret(model, 0);
        model.execute('deleteForward');
        expect(model.getText()).toBe('x');
        model.setText('😀x');
        caret(model, 0);
        model.execute('deleteForward');
        expect(model.getText()).toBe('x');
    });

    it('does not treat an escaped quote or disabled pairing as an empty pair', () => {
        const model = new DocumentModel('\\""');
        caret(model, 2);
        model.execute('smartBackspace');
        expect(model.getText()).toBe('\\"');
        model.setText('()');
        caret(model, 1);
        model.execute('smartBackspace', { autoClosingPairs: false });
        expect(model.getText()).toBe(')');
    });

    it('removes indentation to visual tab stops and merges overlapping deletion ranges', () => {
        const model = new DocumentModel('\t      text');
        caret(model, 7);
        model.execute('smartBackspace', { tabSize: 4 });
        expect(model.getText()).toBe('\t    text');
        expect(model.getSelections()[0]!.head).toBe(5);
        model.execute('smartBackspace', { tabSize: 4 });
        expect(model.getText()).toBe('\ttext');
        model.execute('smartBackspace', { tabSize: 4 });
        expect(model.getText()).toBe('text');
        model.setText('      x');
        model.setSelections([
            { anchor: 2, head: 2 },
            { anchor: 4, head: 4 }
        ]);
        model.execute('smartBackspace');
        expect(model.getText()).toBe('  x');
        expect(model.getSelections()).toEqual([{ anchor: 0, head: 0 }]);
        model.undo();
        expect(model.getSelections()).toHaveLength(2);
    });

    it('creates an indented blank line between a pair with CRLF and tabs at multiple carets', () => {
        const model = new DocumentModel('\t{}\r\n[]');
        model.setSelections([
            { anchor: 2, head: 2 },
            { anchor: 6, head: 6 }
        ]);
        model.execute('insertNewline', { insertSpaces: false });
        expect(model.getText()).toBe('\t{\r\n\t\t\r\n\t}\r\n[\r\n\t\r\n]');
        expect(model.getSelections()).toEqual([
            { anchor: 6, head: 6 },
            { anchor: 16, head: 16 }
        ]);
        model.undo();
        expect(model.getText()).toBe('\t{}\r\n[]');
        model.redo();
        expect(model.getLineCount()).toBe(6);
    });
});

describe('selection expansion and line blocks', () => {
    it('expands Unicode words through inner and outer delimiters and shrinks to the original caret', () => {
        const model = new DocumentModel('call(😀, e\u0301clair)\r\n');
        caret(model, 11);
        const selections = [model.getSelections()];
        while (model.execute('expandSelection')) {
            selections.push(model.getSelections());
        }
        expect(model.getText().slice(selections[1]![0]!.anchor, selections[1]![0]!.head)).toBe('e\u0301clair');
        expect(selections.some((value) => model.slice(value[0]!.anchor, value[0]!.head) === '😀, e\u0301clair')).toBe(true);
        expect(selections.some((value) => model.slice(value[0]!.anchor, value[0]!.head) === '(😀, e\u0301clair)')).toBe(true);
        expect(model.getSelections()).toEqual([{ anchor: 0, head: model.getLength() }]);
        for (let i = selections.length - 2; i >= 0; i--) {
            expect(model.execute('shrinkSelection')).toBe(true);
            expect(model.getSelections()).toEqual(selections[i]);
        }
        expect(model.execute('shrinkSelection')).toBe(false);
        expect(model.getRevision()).toBe(0);
    });

    it('restores multiple reversed selections and invalidates expansion history after an edit or explicit selection', () => {
        const model = new DocumentModel('fn(one, two)');
        model.setSelections([
            { anchor: 5, head: 4 },
            { anchor: 10, head: 9 }
        ]);
        const before = model.getSelections();
        model.execute('expandSelection');
        model.execute('expandSelection');
        model.execute('shrinkSelection');
        model.execute('shrinkSelection');
        expect(model.getSelections()).toEqual(before);
        model.execute('expandSelection');
        model.typeText('x');
        expect(model.execute('shrinkSelection')).toBe(false);
        model.undo();
        model.execute('expandSelection');
        model.setSelections(model.getSelections());
        expect(model.execute('shrinkSelection')).toBe(false);
    });

    it('duplicates a reversed selection in place and selects the copy forward', () => {
        const model = new DocumentModel('a\r\nb\r\nc');
        model.setSelections([{ anchor: 6, head: 0 }]);
        model.execute('duplicateLine');
        expect(model.getText()).toBe('a\r\nb\r\na\r\nb\r\nc');
        expect(model.getSelections()).toEqual([{ anchor: 6, head: 12 }]);
        model.undo();
        expect(model.getSelections()).toEqual([{ anchor: 6, head: 0 }]);
    });

    it('moves only affected blocks while preserving mixed newline slots and Unicode columns', () => {
        const model = new DocumentModel('a\r\n😀b\nc\r\nd');
        model.setSelections([
            { anchor: 5, head: 5 },
            { anchor: 11, head: 11 }
        ]);
        model.execute('moveLineUp');
        expect(model.getText()).toBe('😀b\r\na\nd\r\nc');
        expect(model.getSelections()).toEqual([
            { anchor: 2, head: 2 },
            { anchor: 8, head: 8 }
        ]);
        model.execute('moveLineDown');
        expect(model.getText()).toBe('a\r\n😀b\nc\r\nd');
        expect(model.getSelections()).toEqual([
            { anchor: 5, head: 5 },
            { anchor: 11, head: 11 }
        ]);
    });
});

describe('Tab', () => {
    it('inserts up to the next tab stop at the caret', () => {
        const model = new DocumentModel('ab\n  cd');
        caret(model, 2);
        model.execute('insertTab', { tabSize: 4 });
        expect(model.getText()).toBe('ab  \n  cd');
        expect(model.getSelections()[0]!.head).toBe(4);
        caret(model, 6);
        model.execute('insertTab', { tabSize: 4 });
        expect(model.getText()).toBe('ab  \n     cd');
        model.setText('a');
        caret(model, 1);
        model.execute('insertTab', { insertSpaces: false });
        expect(model.getText()).toBe('a\t');
    });

    it('counts a tab in the line before the caret as reaching its own stop', () => {
        const model = new DocumentModel('\tx');
        caret(model, 2);
        model.execute('insertTab', { tabSize: 4 });
        expect(model.getText()).toBe('\tx   ');
    });

    it('inserts at every caret and indents the lines when there is a selection', () => {
        const model = new DocumentModel('a\nbc');
        model.setSelections([
            { anchor: 1, head: 1 },
            { anchor: 4, head: 4 }
        ]);
        model.execute('insertTab', { tabSize: 2 });
        expect(model.getText()).toBe('a \nbc  ');
        model.setText('one\ntwo');
        model.setSelections([{ anchor: 1, head: 6 }]);
        model.execute('insertTab', { tabSize: 2 });
        expect(model.getText()).toBe('  one\n  two');
    });

    it('steps over a closer the editor inserted', () => {
        const model = new DocumentModel();
        model.typeText('f');
        model.typeText('(');
        model.typeText('a');
        model.execute('insertTab');
        expect(model.getText()).toBe('f(a)');
        expect(model.getSelections()[0]!.head).toBe(4);
        model.execute('insertTab', { tabSize: 4 });
        expect(model.getText()).toBe('f(a)    ');
    });

    it('steps out through nested closers one at a time and out of a quote', () => {
        const model = new DocumentModel();
        model.typeText('[');
        model.typeText('{');
        model.typeText('"');
        model.typeText('x');
        model.execute('insertTab');
        model.execute('insertTab');
        model.execute('insertTab');
        expect(model.getText()).toBe('[{"x"}]');
        expect(model.getSelections()[0]!.head).toBe(7);
    });

    it('forgets a closer once the caret left, and when the option is off', () => {
        const model = new DocumentModel();
        model.typeText('(');
        model.setSelections([{ anchor: 0, head: 0 }]);
        model.setSelections([{ anchor: 1, head: 1 }]);
        model.execute('insertTab', { tabSize: 4 });
        expect(model.getText()).toBe('(   )');
        const off = new DocumentModel();
        off.typeText('(');
        off.execute('insertTab', { tabSize: 4, tabOutOfClosers: false });
        expect(off.getText()).toBe('(   )');
    });

    it('does not step over a closer typed by hand', () => {
        const model = new DocumentModel('(a)');
        caret(model, 2);
        model.execute('insertTab', { tabSize: 4 });
        expect(model.getText()).toBe('(a  )');
    });
});

describe('delete line and duplicate', () => {
    it('keeps the column of the caret on the line that follows', () => {
        const model = new DocumentModel('one\ntwo three\nfour');
        caret(model, 8);
        model.execute('deleteLine');
        expect(model.getText()).toBe('one\nfour');
        expect(model.getSelections()).toEqual([{ anchor: 8, head: 8 }]);
        model.undo();
        caret(model, 11);
        model.execute('deleteLine');
        expect(model.getSelections()).toEqual([{ anchor: 8, head: 8 }]);
    });

    it('clamps to a shorter line and moves up from the last line', () => {
        const model = new DocumentModel('abcdef\nxy\nlonger');
        caret(model, 5);
        model.execute('deleteLine');
        expect(model.getText()).toBe('xy\nlonger');
        expect(model.getSelections()).toEqual([{ anchor: 2, head: 2 }]);
        caret(model, 6);
        model.execute('deleteLine');
        expect(model.getText()).toBe('xy');
        expect(model.getSelections()).toEqual([{ anchor: 2, head: 2 }]);
    });

    it('deletes the lines of every caret and puts each on the line after its block', () => {
        const model = new DocumentModel('a1\nb2\nc3\nd4\ne5');
        model.setSelections([
            { anchor: 1, head: 1 },
            { anchor: 10, head: 10 }
        ]);
        model.execute('deleteLine');
        expect(model.getText()).toBe('b2\nc3\ne5');
        expect(model.getSelections()).toEqual([
            { anchor: 1, head: 1 },
            { anchor: 7, head: 7 }
        ]);
    });

    it('duplicates the selection in place and selects the copy', () => {
        const model = new DocumentModel('foo bar baz');
        model.setSelections([{ anchor: 4, head: 7 }]);
        model.execute('duplicateLine');
        expect(model.getText()).toBe('foo barbar baz');
        expect(model.getSelections()).toEqual([{ anchor: 7, head: 10 }]);
        model.execute('duplicateLine');
        expect(model.getText()).toBe('foo barbarbar baz');
    });

    it('duplicates the selection of every caret and the line of a caret without one', () => {
        const model = new DocumentModel('ab cd\nef');
        model.setSelections([
            { anchor: 0, head: 2 },
            { anchor: 6, head: 6 }
        ]);
        model.execute('duplicateLine');
        expect(model.getText()).toBe('abab cd\nef\nef');
        expect(model.getSelections()).toEqual([
            { anchor: 2, head: 4 },
            { anchor: 11, head: 11 }
        ]);
    });

    it('still duplicates the line at a bare caret', () => {
        const model = new DocumentModel('one\ntwo');
        caret(model, 5);
        model.execute('duplicateLine');
        expect(model.getText()).toBe('one\ntwo\ntwo');
        expect(model.getSelections()).toEqual([{ anchor: 9, head: 9 }]);
    });
});
