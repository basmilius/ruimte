import { describe, expect, it, mock, spyOn } from 'bun:test';
import { DocumentModel } from './document.ts';
import { TextRope } from './rope.ts';

function referenceLines(text: string): { start: number; end: number; next: number; text: string }[] {
    const lines: { start: number; end: number; next: number; text: string }[] = [];
    let start = 0;
    for (const match of text.matchAll(/\r?\n/g)) {
        lines.push({ start, end: match.index, next: match.index + match[0].length, text: text.slice(start, match.index) });
        start = match.index + match[0].length;
    }
    lines.push({ start, end: text.length, next: text.length, text: text.slice(start) });
    return lines;
}

function random(seed: number): () => number {
    return () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        return (seed >>> 0) / 4294967296;
    };
}

describe('persistent text and line index', () => {
    it('preserves old versions through randomized edits across leaf and line boundaries', () => {
        const rand = random(14723);
        let text = ('aa\r\nb\t😀e\u0301\n' + 'x'.repeat(89)).repeat(100);
        let rope = TextRope.from(text);
        const versions: { rope: TextRope; text: string }[] = [];
        const inserts = ['', '\r', '\n', '\t', '😀', 'e\u0301', 'x'.repeat(2500), '\r\n\tline\n'];
        for (let round = 0; round < 700; round++) {
            if (round % 50 === 0) {
                versions.push({ rope, text });
            }
            const from = Math.floor(rand() * (text.length + 1));
            const to = Math.min(text.length, from + Math.floor(rand() * 3000));
            const insert = inserts[Math.floor(rand() * inserts.length)]!;
            rope = rope.replace(from, to, insert);
            text = text.slice(0, from) + insert + text.slice(to);
            expect(rope.slice()).toBe(text);
            const lines = referenceLines(text);
            expect(rope.lineCount).toBe(lines.length);
            const line = Math.floor(rand() * lines.length);
            expect(rope.getLine(line)).toEqual(lines[line]);
            expect(rope.lineAt(lines[line]!.start)).toBe(line);
            const offset = Math.floor(rand() * (text.length + 1));
            expect(rope.lineAt(offset)).toBe(text.slice(0, offset).split('\n').length - 1);
            expect(rope.slice(from - 10, from + 30)).toBe(text.slice(Math.max(0, from - 10), from + 30));
        }
        for (const version of versions) {
            expect(version.rope.slice()).toBe(version.text);
        }
    });

    it('indexes CRLF and surrogate pairs split across leaves', () => {
        const model = new DocumentModel('x'.repeat(2047) + '\r\n' + 'y'.repeat(2046) + '😀\tend\n');
        expect(model.getLineCount()).toBe(3);
        expect(model.getLine(0)).toEqual({ start: 0, end: 2047, next: 2049, text: 'x'.repeat(2047) });
        expect(model.positionAt(2048)).toEqual({ line: 0, column: 2047 });
        expect(model.offsetAt({ line: 1, column: 2047 })).toBe(4095);
        expect(() => model.applyEdits([{ from: 4096, to: 4096, text: 'x' }])).toThrow(RangeError);
        model.applyEdits([{ from: 2047, to: 2048, text: '' }]);
        expect(model.getLine(0).next).toBe(2048);
        model.undo();
        expect(model.getLine(0).next).toBe(2049);
        expect(model.getLine(999)).toEqual({ start: model.getLength(), end: model.getLength(), next: model.getLength(), text: '' });
        expect(model.getLine(-2)).toEqual(model.getLine(0));
    });

    it('supports empty lines, inserted/deleted breaks and raw UTF-16 slices', () => {
        const model = new DocumentModel();
        expect(model.getLineCount()).toBe(1);
        expect(model.getLine(0)).toEqual({ start: 0, end: 0, next: 0, text: '' });
        model.applyEdits([{ from: 0, to: 0, text: '\r\n😀\n\n' }]);
        expect(model.getLineCount()).toBe(4);
        expect(model.slice(2, 3)).toBe('\ud83d');
        expect(model.slice(-10, 2)).toBe('\r\n');
        expect(model.slice(6, 1)).toBe('');
        model.applyEdits([
            { from: 0, to: 2, text: '' },
            { from: 4, to: 6, text: '\n' }
        ]);
        expect(model.getLineCount()).toBe(2);
        expect(model.getLine(0).text).toBe('😀');
        model.undo();
        expect(model.getLineCount()).toBe(4);
        model.redo();
        expect(model.getLineCount()).toBe(2);
    });

    it('keeps revisions, selection normalization and lazy snapshots independent of full text', () => {
        const original = 'one\r\n\t😀three\n'.repeat(10000);
        const model = new DocumentModel(original);
        model.applyEdits([{ from: 0, to: 0, text: '!' }]);
        const old = model.getSnapshot();
        const slice = spyOn(TextRope.prototype, 'slice');
        try {
            const seen: number[] = [];
            model.subscribe((snapshot) => seen.push(snapshot.revision));
            model.setSelections([{ anchor: 3, head: 3 }]);
            model.positionAt(80000);
            model.offsetAt({ line: 9000, column: 2 });
            model.getSnapshot();
            expect(slice).not.toHaveBeenCalled();
            expect(model.getLine(9000).text).toBe('one');
            expect(slice.mock.calls.every(([from, to]) => from !== undefined && to !== undefined && to - from < 100)).toBe(true);
            slice.mockClear();
            model.applyEdits([{ from: 2, to: 2, text: 'z' }]);
            model.undo();
            model.redo();
            expect(slice.mock.calls.every(([from, to]) => from !== undefined && to !== undefined && to - from < 100)).toBe(true);
            expect(seen).toEqual([1, 2, 3, 4]);
            expect(old.text).toBe('!' + original);
            expect(old.revision).toBe(1);
            expect(model.getText()).toBe('!ozne\r\n\t😀three\n' + original.slice(14));
            const writableSnapshot = model.getSnapshot();
            writableSnapshot.text = 'caller copy';
            expect(writableSnapshot.text).toBe('caller copy');
            expect(model.getSnapshot().text).toBe(model.getText());
            slice.mockClear();
            model.applyEdits([{ from: 0, to: model.getLength(), text: '' }]);
            model.undo();
            expect(slice).not.toHaveBeenCalled();
        } finally {
            slice.mockRestore();
        }
    });

    it('rejects stale external transactions without events, selection or history changes', () => {
        const model = new DocumentModel('one');
        const events = mock();
        model.subscribe(events);
        model.applyEdits([{ from: 0, to: 3, text: 'two' }], { expectedRevision: 0 });
        const before = model.getSnapshot();
        expect(model.applyEdits([{ from: 900, to: 901, text: 'invalid' }], { expectedRevision: 0, selections: [{ anchor: 0, head: 0 }] })).toBe(false);
        expect(model.getSnapshot()).toEqual(before);
        expect(events).toHaveBeenCalledTimes(1);
        model.undo();
        expect(model.applyEdits([{ from: 0, to: 3, text: 'two' }], { expectedRevision: 0 })).toBe(false);
        expect(model.getSnapshot().canRedo).toBe(true);
        expect(model.getRevision()).toBe(2);
    });

    it('recognizes collective no-ops without flattening unaffected text', () => {
        const model = new DocumentModel('a'.repeat(10000));
        expect(
            model.applyEdits([
                { from: 0, to: 1, text: '' },
                { from: 9999, to: 9999, text: 'a' }
            ])
        ).toBe(false);
        expect(model.getRevision()).toBe(0);
        expect(model.getSnapshot().canUndo).toBe(false);
        model.applyEdits([
            { from: 1, to: 1, text: 'x' },
            { from: 1, to: 2, text: 'y' }
        ]);
        expect(model.slice(0, 5)).toBe('axyaa');
    });

    it('keeps the 200-entry history bound and grouped edits with indexed lines', () => {
        const model = new DocumentModel('start\r\n');
        for (let i = 0; i < 230; i++) {
            model.applyEdits([{ from: 0, to: 0, text: `\t${i}😀\n` }]);
        }
        for (let i = 0; i < 200; i++) {
            expect(model.undo()).toBe(true);
        }
        expect(model.undo()).toBe(false);
        expect(model.getLineCount()).toBe(32);
        for (let i = 0; i < 200; i++) {
            expect(model.redo()).toBe(true);
        }
        expect(model.getLineCount()).toBe(232);
        expect(model.redo()).toBe(false);
    });

    it('round-trips simultaneous Unicode/CRLF/tab edits against an independent string reference', () => {
        const rand = random(93417);
        let text = '😀\r\n\tété\u0301\n'.repeat(500);
        const model = new DocumentModel(text);
        const inserts = ['', '\t', '😀', '\r\n', '\r', '\n', 'e\u0301\t𝒜'];
        const boundary = (offset: number): number =>
            /[\ud800-\udbff]/.test(text[offset - 1] ?? '') && /[\udc00-\udfff]/.test(text[offset] ?? '') ? offset - 1 : offset;
        for (let round = 0; round < 300; round++) {
            const split = Math.floor(text.length / 2);
            const from = boundary(Math.floor(rand() * split));
            const second = boundary(split + Math.floor(rand() * (text.length - split)));
            const edits = [
                { from, to: boundary(Math.min(from + 5, second)), text: inserts[Math.floor(rand() * inserts.length)]! },
                { from: second, to: boundary(Math.min(second + 3, text.length)), text: inserts[Math.floor(rand() * inserts.length)]! }
            ];
            const before = text;
            for (const edit of [...edits].reverse()) {
                text = text.slice(0, edit.from) + edit.text + text.slice(edit.to);
            }
            const changed = model.applyEdits(edits);
            expect(changed).toBe(before !== text);
            expect(model.getText()).toBe(text);
            expect(model.getLineCount()).toBe(referenceLines(text).length);
            if (changed) {
                model.undo();
                expect(model.getText()).toBe(before);
                model.redo();
                expect(model.getText()).toBe(text);
            }
        }
    });
});
