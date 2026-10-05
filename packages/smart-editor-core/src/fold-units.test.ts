import { describe, expect, it } from 'bun:test';
import { DocumentModel } from './document.ts';
import type { CommandOptions } from './types.ts';

// Lines 1 to 3 are one collapsed fold: `function a() {` with its body and its closer.
const TEXT = ['one', 'function a() {', '    body();', '}', 'two', 'three'].join('\n');
const FOLD = { first: 1, last: 3 };
const lineSpan: NonNullable<CommandOptions['lineSpan']> = (line) => (line >= FOLD.first && line <= FOLD.last ? FOLD : { first: line, last: line });
const options: CommandOptions = { lineSpan, language: 'typescript' };

function model(text = TEXT): DocumentModel {
    return new DocumentModel(text);
}

function atLine(target: DocumentModel, line: number, column = 0): void {
    const offset = target.offsetAt({ line, column });
    target.setSelections([{ anchor: offset, head: offset }]);
}

describe('line commands on a collapsed fold', () => {
    it('deletes the whole fold', () => {
        const target = model();
        atLine(target, 1);
        target.execute('deleteLine', options);
        expect(target.getText()).toBe('one\ntwo\nthree');
    });

    it('duplicates the whole fold and leaves the caret on the copy', () => {
        const target = model();
        atLine(target, 1, 3);
        target.execute('duplicateLine', options);
        expect(target.getText()).toBe(['one', 'function a() {', '    body();', '}', 'function a() {', '    body();', '}', 'two', 'three'].join('\n'));
        expect(target.positionAt(target.getPrimary().head)).toEqual({ line: 4, column: 3 });
    });

    it('comments the whole fold and puts the caret on the line after it', () => {
        const target = model();
        atLine(target, 1);
        target.execute('toggleLineComment', options);
        expect(target.getText()).toBe(['one', '// function a() {', '//     body();', '// }', 'two', 'three'].join('\n'));
        expect(target.positionAt(target.getPrimary().head).line).toBe(4);
        atLine(target, 1);
        target.execute('toggleLineComment', options);
        expect(target.getText()).toBe(TEXT);
    });

    it('moves the whole fold past the line above and below, and says where each line went', () => {
        const target = model();
        atLine(target, 1);
        let moves: readonly { from: number; to: number }[] = [];
        target.execute('moveLineUp', { ...options, onLinesMoved: (reported) => (moves = reported) });
        expect(target.getText()).toBe(['function a() {', '    body();', '}', 'one', 'two', 'three'].join('\n'));
        expect(moves).toEqual([
            { from: 1, to: 0 },
            { from: 2, to: 1 },
            { from: 3, to: 2 },
            { from: 0, to: 3 }
        ]);
        expect(target.positionAt(target.getPrimary().head).line).toBe(0);
    });

    it('moves it down past the line below', () => {
        const target = model();
        atLine(target, 1);
        target.execute('moveLineDown', options);
        expect(target.getText()).toBe(['one', 'two', 'function a() {', '    body();', '}', 'three'].join('\n'));
    });

    it('swaps with a whole fold when it moves onto one', () => {
        const target = model();
        atLine(target, 4);
        target.execute('moveLineUp', options);
        expect(target.getText()).toBe(['one', 'two', 'function a() {', '    body();', '}', 'three'].join('\n'));
    });

    it('acts on the lines one by one without a span', () => {
        const target = model();
        atLine(target, 1);
        target.execute('deleteLine');
        expect(target.getText()).toBe('one\n    body();\n}\ntwo\nthree');
    });
});

describe('word moves over a collapsed fold', () => {
    it('goes from the end of its first line to the start of the line after it, in one stop', () => {
        const target = model();
        atLine(target, 1, 14);
        target.execute('wordRight', options);
        expect(target.positionAt(target.getPrimary().head)).toEqual({ line: 4, column: 0 });
    });

    it('comes back to the end of its first line and then walks the line above', () => {
        const target = model();
        atLine(target, 4, 0);
        target.execute('wordLeft', options);
        expect(target.positionAt(target.getPrimary().head)).toEqual({ line: 1, column: 14 });
        target.execute('selectWordLeft', options);
        expect(target.positionAt(target.getPrimary().head).line).toBe(1);
    });

    it('extends a selection past the fold as one stop', () => {
        const target = model();
        atLine(target, 1, 14);
        target.execute('selectWordRight', options);
        expect(target.getSelections()[0]).toEqual({ anchor: target.offsetAt({ line: 1, column: 14 }), head: target.offsetAt({ line: 4, column: 0 }) });
    });

    it('never lands inside it from the line before', () => {
        const target = model();
        atLine(target, 0, 3);
        target.execute('wordRight', options);
        expect(target.positionAt(target.getPrimary().head)).toEqual({ line: 1, column: 0 });
        target.execute('wordRight', options);
        expect(target.positionAt(target.getPrimary().head).line).toBe(1);
    });
});

describe('adding a caret over a collapsed fold', () => {
    it('skips the folded lines below and above', () => {
        const target = model();
        atLine(target, 0, 2);
        target.execute('addCaretBelow', options);
        target.execute('addCaretBelow', options);
        expect(target.getSelections().map((selection) => target.positionAt(selection.head).line)).toEqual([0, 1, 4]);
        const above = model();
        atLine(above, 4, 2);
        above.execute('addCaretAbove', options);
        expect(above.getSelections().map((selection) => above.positionAt(selection.head).line)).toEqual([4, 1]);
    });
});
