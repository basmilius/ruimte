import { describe, expect, it } from 'bun:test';
import { DocumentModel } from './document.ts';

describe('simultaneous document transactions', () => {
    it('applies original-coordinate edits and maps independent carets', () => {
        const model = new DocumentModel('alpha beta gamma');
        model.setSelections([
            { anchor: 5, head: 5 },
            { anchor: 10, head: 10 }
        ]);
        model.applyEdits([
            { from: 6, to: 10, text: 'B' },
            { from: 0, to: 5, text: 'A' }
        ]);
        expect(model.getText()).toBe('A B gamma');
        expect(model.getSelections()).toEqual([
            { anchor: 1, head: 1 },
            { anchor: 3, head: 3 }
        ]);
        expect(model.getSnapshot().revision).toBe(1);
        expect(model.undo()).toBe(true);
        expect(model.getText()).toBe('alpha beta gamma');
        expect(model.getSelections()).toEqual([
            { anchor: 5, head: 5 },
            { anchor: 10, head: 10 }
        ]);
        expect(model.redo()).toBe(true);
        expect(model.getText()).toBe('A B gamma');
        expect(model.getSnapshot().revision).toBe(3);
    });

    it('maps an endpoint through all adjacent edits with right affinity', () => {
        const model = new DocumentModel('ab');
        model.setSelections([{ anchor: 1, head: 1 }]);
        model.applyEdits([
            { from: 0, to: 1, text: 'XX' },
            { from: 1, to: 1, text: 'Y' }
        ]);
        expect(model.getText()).toBe('XXYb');
        expect(model.getSelections()).toEqual([{ anchor: 3, head: 3 }]);
    });

    it('rejects overlapping, out-of-bounds and surrogate-splitting edits atomically', () => {
        const model = new DocumentModel('a😀bc');
        expect(() =>
            model.applyEdits([
                { from: 0, to: 3, text: '' },
                { from: 1, to: 4, text: '' }
            ])
        ).toThrow(RangeError);
        expect(() => model.applyEdits([{ from: 6, to: 6, text: '' }])).toThrow(RangeError);
        expect(() => model.applyEdits([{ from: 2, to: 2, text: 'x' }])).toThrow(RangeError);
        expect(model.getText()).toBe('a😀bc');
        expect(model.getSnapshot().revision).toBe(0);
    });

    it('deduplicates identical edits and prevents conflicting insertions', () => {
        const model = new DocumentModel('ab');
        model.applyEdits([
            { from: 1, to: 1, text: 'X' },
            { from: 1, to: 1, text: 'X' }
        ]);
        expect(model.getText()).toBe('aXb');
        expect(() =>
            model.applyEdits([
                { from: 0, to: 0, text: 'x' },
                { from: 0, to: 0, text: 'y' }
            ])
        ).toThrow();
    });

    it('copies selections and normalizes duplicates, overlaps, bounds and pairs', () => {
        const model = new DocumentModel('a😀bc');
        const selection = { anchor: -1, head: 2 };
        model.setSelections([selection, { anchor: 0, head: 3 }, { anchor: 99, head: 99 }]);
        selection.head = 5;
        expect(model.getSelections()).toEqual([
            { anchor: 0, head: 3 },
            { anchor: 5, head: 5 }
        ]);
        const snapshot = model.getSnapshot();
        (snapshot.selections[0] as { head: number }).head = 5;
        expect(model.getSelections()[0]!.head).toBe(3);
        model.setSelections([]);
        expect(model.getSelections()).toEqual([{ anchor: 0, head: 0 }]);
    });

    it('does not record or increment revision for text no-ops', () => {
        const model = new DocumentModel('ab');
        expect(model.applyEdits([{ from: 0, to: 2, text: 'ab' }], { selections: [{ anchor: 1, head: 1 }] })).toBe(false);
        expect(model.getSnapshot()).toMatchObject({ revision: 0, canUndo: false });
        expect(model.getSelections()[0]!.head).toBe(1);
    });

    it('groups contiguous typing and separates cursor navigation', () => {
        const model = new DocumentModel();
        model.applyEdits([{ from: 0, to: 0, text: 'a' }], { historyGroup: 'typing' });
        model.applyEdits([{ from: 1, to: 1, text: 'b' }], { historyGroup: 'typing' });
        model.setSelections([{ anchor: 0, head: 0 }]);
        model.applyEdits([{ from: 0, to: 0, text: 'c' }], { historyGroup: 'typing' });
        model.undo();
        expect(model.getText()).toBe('ab');
        model.undo();
        expect(model.getText()).toBe('');
        model.redo();
        model.applyEdits([{ from: 2, to: 2, text: 'd' }]);
        expect(model.redo()).toBe(false);
    });

    it('restores text and exact directional selections across external changes', () => {
        const model = new DocumentModel('hello');
        model.setSelections([{ anchor: 5, head: 1 }]);
        model.setText('changed');
        model.undo();
        expect(model.getText()).toBe('hello');
        expect(model.getSelections()).toEqual([{ anchor: 5, head: 1 }]);
    });

    it('notifies selection changes without revising text and supports disposal', () => {
        const model = new DocumentModel('hello');
        const revisions: number[] = [];
        const subscription = model.subscribe((snapshot) => revisions.push(snapshot.revision));
        model.setSelections([{ anchor: 1, head: 1 }]);
        model.applyEdits([{ from: 0, to: 0, text: '!' }]);
        subscription.dispose();
        model.undo();
        expect(revisions).toEqual([0, 1]);
    });

    it('converts LF and CRLF positions and clamps out of range columns', () => {
        const model = new DocumentModel('ab\r\n😀c\n');
        expect(model.positionAt(4)).toEqual({ line: 1, column: 0 });
        expect(model.positionAt(3)).toEqual({ line: 0, column: 2 });
        expect(model.offsetAt({ line: 1, column: 99 })).toBe(7);
        expect(model.offsetAt({ line: 1, column: 1 })).toBe(4);
        expect(model.offsetAt({ line: 99, column: 0 })).toBe(8);
    });
});

describe('editing commands', () => {
    it('toggles smart Home between indentation and physical line start', () => {
        const model = new DocumentModel('  text');
        model.setSelections([{ anchor: 6, head: 6 }]);
        model.execute('smartHome');
        expect(model.getSelections()[0]!.head).toBe(2);
        model.execute('smartHome');
        expect(model.getSelections()[0]!.head).toBe(0);
    });

    it('collapses selections on movement and extends on select movement', () => {
        const model = new DocumentModel('fooBar baz');
        model.setSelections([{ anchor: 6, head: 0 }]);
        model.execute('wordRight');
        expect(model.getSelections()).toEqual([{ anchor: 6, head: 6 }]);
        model.execute('selectWordRight');
        expect(model.getSelections()).toEqual([{ anchor: 6, head: 10 }]);
    });

    it('deletes overlapping word ranges once for multiple carets', () => {
        const model = new DocumentModel('foobar');
        model.setSelections([
            { anchor: 2, head: 2 },
            { anchor: 4, head: 4 }
        ]);
        model.execute('deleteWordLeft');
        expect(model.getText()).toBe('ar');
        expect(model.getSelections()).toEqual([{ anchor: 0, head: 0 }]);
        model.undo();
        expect(model.getSelections()).toHaveLength(2);
    });

    it('indents lines once and excludes an endpoint at the following line start', () => {
        const model = new DocumentModel('one\ntwo\nthree');
        model.setSelections([{ anchor: 0, head: 8 }]);
        model.execute('indent', { tabSize: 2 });
        expect(model.getText()).toBe('  one\n  two\nthree');
        model.execute('outdent', { tabSize: 2 });
        expect(model.getText()).toBe('one\ntwo\nthree');
    });

    it('bounds indentation settings and handles non-finite values', () => {
        const model = new DocumentModel('text');
        model.execute('indent', { tabSize: Number.NaN });
        expect(model.getText()).toBe('    text');
        model.execute('outdent', { tabSize: Number.POSITIVE_INFINITY });
        expect(model.getText()).toBe('text');
        model.execute('indent', { tabSize: -5 });
        expect(model.getText()).toBe(' text');
    });

    it('toggles comments after indentation and retains directional selection', () => {
        const model = new DocumentModel('  one\n\ttwo');
        model.setSelections([{ anchor: 10, head: 0 }]);
        model.execute('toggleLineComment');
        expect(model.getText()).toBe('  // one\n\t// two');
        model.execute('toggleLineComment');
        expect(model.getText()).toBe('  one\n\ttwo');
        expect(model.getSelections()[0]!.anchor).toBeGreaterThan(model.getSelections()[0]!.head);
    });

    it('inserts newline with existing indentation and extra block indent at multiple carets', () => {
        const model = new DocumentModel('  {\n  x');
        model.setSelections([
            { anchor: 3, head: 3 },
            { anchor: 7, head: 7 }
        ]);
        model.execute('insertNewline', { tabSize: 2 });
        expect(model.getText()).toBe('  {\n    \n  x\n  ');
        model.undo();
        expect(model.getText()).toBe('  {\n  x');
    });

    it('preserves CRLF for inserted newlines', () => {
        const model = new DocumentModel('a\r\nb');
        model.setSelections([{ anchor: 4, head: 4 }]);
        model.execute('insertNewline');
        expect(model.getText()).toBe('a\r\nb\r\n');
    });

    it('duplicates selected full lines with and without a final newline', () => {
        const model = new DocumentModel('a\nb');
        model.setSelections([{ anchor: 3, head: 3 }]);
        model.execute('duplicateLine');
        expect(model.getText()).toBe('a\nb\nb');
        expect(model.getSelections()[0]!.head).toBe(5);
        model.undo();
        model.setSelections([{ anchor: 0, head: 0 }]);
        model.execute('duplicateLine');
        expect(model.getText()).toBe('a\na\nb');
        expect(model.getSelections()[0]!.head).toBe(2);
    });

    it('duplicates disjoint line blocks and maps all caret offsets', () => {
        const model = new DocumentModel('aa\nbb\ncc\ndd');
        model.setSelections([
            { anchor: 1, head: 1 },
            { anchor: 7, head: 7 }
        ]);
        model.execute('duplicateLine');
        expect(model.getText()).toBe('aa\naa\nbb\ncc\ncc\ndd');
        expect(model.getSelections()).toEqual([
            { anchor: 4, head: 4 },
            { anchor: 13, head: 13 }
        ]);
    });

    it('deletes final lines without leaving an unwanted separator', () => {
        const model = new DocumentModel('one\ntwo');
        model.setSelections([{ anchor: 7, head: 7 }]);
        model.execute('deleteLine');
        expect(model.getText()).toBe('one');
        model.undo();
        model.execute('selectAll');
        model.execute('deleteLine');
        expect(model.getText()).toBe('');
    });

    it('moves line blocks and directional selections with content', () => {
        const model = new DocumentModel('aa\nbb\ncc\ndd');
        model.setSelections([{ anchor: 8, head: 3 }]);
        model.execute('moveLineUp');
        expect(model.getText()).toBe('bb\ncc\naa\ndd');
        expect(model.getSelections()).toEqual([{ anchor: 5, head: 0 }]);
        model.execute('moveLineDown');
        expect(model.getText()).toBe('aa\nbb\ncc\ndd');
        expect(model.getSelections()).toEqual([{ anchor: 8, head: 3 }]);
    });

    it('preserves a whole-line selection ending at the next line start when moving', () => {
        const model = new DocumentModel('aa\nbb\ncc\ndd');
        model.setSelections([{ anchor: 3, head: 9 }]);
        model.execute('moveLineUp');
        expect(model.getText()).toBe('bb\ncc\naa\ndd');
        expect(model.getSelections()).toEqual([{ anchor: 0, head: 6 }]);
        model.execute('moveLineDown');
        expect(model.getSelections()).toEqual([{ anchor: 3, head: 9 }]);
    });

    it('moves disjoint blocks independently and respects boundaries', () => {
        const model = new DocumentModel('a\nb\nc\nd');
        model.setSelections([
            { anchor: 2, head: 2 },
            { anchor: 6, head: 6 }
        ]);
        model.execute('moveLineUp');
        expect(model.getText()).toBe('b\na\nd\nc');
        expect(model.getSelections()).toEqual([
            { anchor: 0, head: 0 },
            { anchor: 4, head: 4 }
        ]);
        model.setSelections([{ anchor: 0, head: 0 }]);
        expect(model.execute('moveLineUp')).toBe(false);
    });

    it('adds carets with clamped columns and selects each occurrence once', () => {
        const model = new DocumentModel('hello\nhi\nhello hello');
        model.setSelections([{ anchor: 4, head: 4 }]);
        model.execute('addCaretBelow');
        expect(model.getSelections()).toEqual([
            { anchor: 4, head: 4 },
            { anchor: 8, head: 8 }
        ]);
        model.setSelections([{ anchor: 1, head: 1 }]);
        model.execute('selectNextOccurrence');
        model.execute('selectNextOccurrence');
        model.execute('selectNextOccurrence');
        expect(model.getSelections()).toEqual([
            { anchor: 0, head: 5 },
            { anchor: 9, head: 14 },
            { anchor: 15, head: 20 }
        ]);
        expect(model.execute('selectNextOccurrence')).toBe(false);
    });

    it('round-trips many independent edits through undo and redo', () => {
        const model = new DocumentModel('0123456789');
        for (let round = 0; round < 50; round++) {
            const before = model.getText();
            const at = (round * 7) % (before.length + 1);
            const removed = Math.min(2, before.length - at);
            const inserted = `x${round}`;
            model.applyEdits([{ from: at, to: at + removed, text: inserted }]);
            const after = before.slice(0, at) + inserted + before.slice(at + removed);
            expect(model.getText()).toBe(after);
            model.undo();
            expect(model.getText()).toBe(before);
            model.redo();
            expect(model.getText()).toBe(after);
        }
    });
});

describe('content edits', () => {
    it('reports simultaneous edits last to first, in the positions of the text before them', () => {
        const model = new DocumentModel('one\ntwo\nthree');
        let seen: unknown;
        model.subscribe((snapshot) => {
            seen = snapshot.contentEdits;
        });
        model.applyEdits([
            { from: 0, to: 3, text: 'a\nb' },
            { from: 8, to: 13, text: 'x' }
        ]);
        expect(seen).toEqual([
            { start: { line: 2, column: 0 }, end: { line: 2, column: 5 }, text: 'x' },
            { start: { line: 0, column: 0 }, end: { line: 0, column: 3 }, text: 'a\nb' }
        ]);
    });

    it('reports an undo as the one stretch that differs', () => {
        const model = new DocumentModel('hello world');
        model.applyEdits([{ from: 5, to: 5, text: ',' }], { historyGroup: 'g' });
        let seen: unknown;
        model.subscribe((snapshot) => {
            seen = snapshot.contentEdits;
        });
        model.undo();
        expect(seen).toEqual([{ start: { line: 0, column: 5 }, end: { line: 0, column: 6 }, text: '' }]);
    });
});
