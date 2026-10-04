import { describe, expect, test } from 'bun:test';
import { DocumentModel } from '@ruimte/smart-editor-core';
import { EditorLayout, type LayoutMetrics, scanLine, wrapStops } from './layout.ts';

/* Every character is 10px wide, a line 20px tall, so the numbers in an assertion can be read off the text. */
const METRICS: LayoutMetrics = {
    lineHeight: 20,
    charWidth: 10,
    tabSize: 4,
    measureText: (text) => Array.from(text).length * 20,
    measureInlay: (text) => text.length * 6
};

function layoutOf(text: string, wrapWidth: number | null = null): { layout: EditorLayout; model: DocumentModel } {
    const model = new DocumentModel(text);
    const layout = new EditorLayout(model, METRICS);
    if (wrapWidth !== null) {
        layout.configure({ wrapWidth });
    }
    return { layout, model };
}

describe('rows', () => {
    test('stack one row per line from the top', () => {
        const { layout } = layoutOf('one\ntwo\nthree');
        expect(layout.rows.map((row) => [row.key, row.top, row.height])).toEqual([
            ['line:0', 0, 20],
            ['line:1', 20, 20],
            ['line:2', 40, 20]
        ]);
        expect(layout.height).toBe(60 + 8);
    });

    test('find the row at a height and list the rows around a viewport', () => {
        const { layout } = layoutOf(Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n'));
        expect(layout.rowAt(45).line).toBe(2);
        expect(layout.rowAt(-10).line).toBe(0);
        expect(layout.rowAt(1e6).line).toBe(99);
        const visible = layout.visibleRows(400, 100, 0);
        expect(visible[0]!.line).toBe(20);
        expect(visible.at(-1)!.line).toBe(24);
    });

    test('hide the lines a collapsed fold covers', () => {
        const { layout } = layoutOf('a\nb\nc\nd\ne');
        layout.configure({ folds: [{ startLine: 1, endLine: 3, collapsed: true }] });
        expect(layout.rows.map((row) => row.line)).toEqual([0, 1, 4]);
        expect(layout.isHidden(2)).toBe(true);
        expect(layout.isHidden(4)).toBe(false);
        expect(layout.rowForLine(3).line).toBe(1);
    });

    test('put a widget above or below its line with its own height', () => {
        const { layout } = layoutOf('one\ntwo');
        layout.configure({
            blocks: [
                { id: 'a', at: 4, placement: 'above', height: 30 },
                { id: 'b', at: 0, placement: 'below', height: 10 }
            ]
        });
        expect(layout.rows.map((row) => [row.key, row.top, row.height])).toEqual([
            ['line:0', 0, 20],
            ['block:b', 20, 10],
            ['block:a', 30, 30],
            ['line:1', 60, 20]
        ]);
        expect(layout.setMeasuredHeight('block:a', 50)).toBe(true);
        expect(layout.rows.at(-1)!.top).toBe(80);
    });
});

describe('geometry', () => {
    test('places each character at its width and tabs on the next stop', () => {
        const { layout } = layoutOf('a\tb');
        const geometry = layout.geometry(layout.rows[0] as never);
        expect(geometry.before).toEqual([0, 10, 40, 50]);
        expect(geometry.runs.map((run) => [run.text, run.x])).toEqual([
            ['a', 0],
            ['b', 40]
        ]);
    });

    test('keeps a combined character whole', () => {
        const { layout } = layoutOf('éx');
        const geometry = layout.geometry(layout.rows[0] as never);
        expect(geometry.offsets).toEqual([0, 2, 3]);
    });

    test('adds an inlay between two characters', () => {
        const { layout } = layoutOf('ab');
        layout.configure({ inlays: [{ id: 'hint', at: 1, text: 'xx' }] });
        const geometry = layout.geometry(layout.rows[0] as never);
        expect(geometry.inlays[0]).toMatchObject({ x: 10, width: 24 });
        expect(geometry.before[1]).toBe(10);
        expect(geometry.after[1]).toBe(34);
        expect(geometry.width).toBe(44);
    });
});

describe('hit testing and caret', () => {
    test('map a point to the nearest offset and back', () => {
        const { layout } = layoutOf('hello\nworld');
        expect(layout.hitTest(0, 5)).toBe(0);
        expect(layout.hitTest(14, 5)).toBe(1);
        expect(layout.hitTest(16, 5)).toBe(2);
        expect(layout.hitTest(500, 5)).toBe(5);
        expect(layout.hitTest(26, 30)).toBe(9);
        expect(layout.caret(9)).toMatchObject({ x: 30, y: 20, height: 20 });
    });

    test('answer a click below the last line with the end of the document', () => {
        const { layout } = layoutOf('ab\ncd');
        expect(layout.hitTest(0, 9999)).toBe(3);
    });

    test('draw a range as one box per line, and a line break as one extra character', () => {
        const { layout, model } = layoutOf('abc\ndef');
        const rects = layout.rectangles(1, 6, layout.rows);
        expect(rects).toEqual([
            { x: 10, y: 0, width: 20 + 10, height: 20 },
            { x: 0, y: 20, width: 20, height: 20 }
        ]);
        expect(model.getLength()).toBe(7);
    });
});

describe('movement', () => {
    test('step a character at a time over the end of a line', () => {
        const { layout } = layoutOf('ab\ncd');
        expect(layout.horizontalOffset(1, 1)).toBe(2);
        expect(layout.horizontalOffset(2, 1)).toBe(3);
        expect(layout.horizontalOffset(3, -1)).toBe(2);
        expect(layout.horizontalOffset(0, -1)).toBe(0);
        expect(layout.horizontalOffset(5, 1)).toBe(5);
    });

    test('go up and down at a column and stop at the ends of the document', () => {
        const { layout } = layoutOf('abcdef\nab\nabcdef');
        expect(layout.verticalOffset(4, 1, 40)).toBe(9);
        expect(layout.verticalOffset(9, 1, 40)).toBe(14);
        expect(layout.verticalOffset(14, -1, 40)).toBe(9);
        expect(layout.verticalOffset(2, -1, 20)).toBe(0);
        expect(layout.verticalOffset(14, 1, 40)).toBe(16);
    });

    test('walk over a widget between two lines', () => {
        const { layout } = layoutOf('ab\ncd');
        layout.configure({ blocks: [{ id: 'w', at: 3, placement: 'above', height: 30 }] });
        expect(layout.verticalOffset(1, 1, 10)).toBe(4);
    });
});

describe('soft wrap', () => {
    test('breaks after the space a word ends in', () => {
        const text = 'aaa bbb ccc';
        const offsets = Array.from({ length: text.length + 1 }, (_, i) => i);
        expect(wrapStops(text, offsets, METRICS, 60)).toEqual([4, 8]);
        expect(wrapStops(text, offsets, METRICS, 1000)).toEqual([]);
    });

    test('breaks in the middle of a word that is longer than the line', () => {
        const text = 'abcdefghij';
        const offsets = Array.from({ length: text.length + 1 }, (_, i) => i);
        expect(wrapStops(text, offsets, METRICS, 40)).toEqual([4, 8]);
    });

    test('lets trailing spaces hang over the edge instead of wrapping them', () => {
        const text = 'ab     cd';
        const offsets = Array.from({ length: text.length + 1 }, (_, i) => i);
        expect(wrapStops(text, offsets, METRICS, 40)).toEqual([7]);
    });

    test('lays a wrapped line over several visual lines', () => {
        const geometry = scanLine({ start: 0, end: 11, text: 'aaa bbb ccc' }, METRICS, 60, []);
        expect(geometry.subRows).toBe(3);
        expect(geometry.rowOf).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]);
        expect(geometry.runs.map((run) => [run.text, run.subRow, run.x])).toEqual([
            ['aaa bbb ccc'.slice(0, 4), 0, 0],
            ['bbb ', 1, 0],
            ['ccc', 2, 0]
        ]);
    });

    test('grows a row to the lines it wraps into once the row is drawn', () => {
        const { layout } = layoutOf('aaa bbb ccc\nshort', 60);
        // The estimate is by length alone, which a wrap at word ends can exceed.
        const before = layout.rows[0]!.height;
        expect(layout.syncRows(layout.rows)).toBe(before !== 60);
        expect(layout.rows[0]).toMatchObject({ subRows: 3, height: 60 });
        expect(layout.rows[1]).toMatchObject({ top: 60, height: 20 });
    });

    test('puts the caret on the visual line a character is on', () => {
        const { layout } = layoutOf('aaa bbb ccc', 60);
        layout.syncRows(layout.rows);
        expect(layout.caret(5)).toMatchObject({ x: 10, y: 20 });
        expect(layout.caret(9)).toMatchObject({ x: 10, y: 40 });
    });

    test('hits the character under a point on a wrapped line, and the end of a visual line', () => {
        const { layout } = layoutOf('aaa bbb ccc', 60);
        layout.syncRows(layout.rows);
        expect(layout.hitTest(14, 25)).toBe(5);
        expect(layout.hitTest(400, 5)).toBe(4);
        expect(layout.hitTest(400, 45)).toBe(11);
    });

    test('goes down a visual line and not a document line', () => {
        const { layout } = layoutOf('aaa bbb ccc\nx', 60);
        layout.syncRows(layout.rows);
        expect(layout.verticalOffset(5, 1, 10)).toBe(9);
        expect(layout.verticalOffset(9, 1, 10)).toBe(13);
    });

    test('draws a selection across a wrap as a box on each visual line', () => {
        const { layout } = layoutOf('aaa bbb ccc', 60);
        layout.syncRows(layout.rows);
        expect(layout.rectangles(2, 9, layout.rows)).toEqual([
            { x: 20, y: 0, width: 20, height: 20 },
            { x: 0, y: 20, width: 40, height: 20 },
            { x: 0, y: 40, width: 10, height: 20 }
        ]);
    });
});
