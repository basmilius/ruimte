import type { Selection } from '@ruimte/smart-editor-core';
import { type EditorLayout, TEXT_PADDING } from './layout.ts';

export interface ContentPoint {
    x: number;
    y: number;
}

/* The cell of a monospaced grid an x falls in, which stands in for the visual column since a tab is a whole number of cells. */
export function cellAt(layout: EditorLayout, x: number): number {
    return Math.max(0, Math.round((x - TEXT_PADDING) / layout.metrics.charWidth));
}

/*
 * One selection per line between two points, each spanning the same visual columns, the way a column
 * (box) selection works. A line that ends before the box starts has no text in it: it gets a caret at
 * its end when the box is only a column of carets, and none otherwise.
 */
export function columnSelections(layout: EditorLayout, from: ContentPoint, to: ContentPoint): Selection[] {
    const { charWidth } = layout.metrics;
    const document = layout.document;
    const fromLine = document.positionAt(layout.hitTest(from.x, from.y)).line;
    const toLine = document.positionAt(layout.hitTest(to.x, to.y)).line;
    const fromCell = cellAt(layout, from.x);
    const toCell = cellAt(layout, to.x);
    const left = Math.min(fromCell, toCell);
    const right = Math.max(fromCell, toCell);
    const reversed = toCell < fromCell;
    const result: Selection[] = [];
    for (let line = Math.min(fromLine, toLine); line <= Math.max(fromLine, toLine); line++) {
        const row = layout.rowForLine(line);
        if (row.kind !== 'text' || layout.isHidden(line)) {
            continue;
        }
        const geometry = layout.geometry(row);
        const endX = geometry.rowStarts.length > 1 ? geometry.rowEnds[0]! : geometry.before[geometry.before.length - 1]!;
        const offsetAt = (cell: number): number => layout.offsetAtX(geometry, 0, TEXT_PADDING + cell * charWidth).offset;
        if (cellAt(layout, endX + TEXT_PADDING) < left) {
            if (left === right) {
                const end = document.getLine(line).end;
                result.push({ anchor: end, head: end });
            }
            continue;
        }
        const start = offsetAt(left);
        const end = offsetAt(right);
        result.push(reversed ? { anchor: end, head: start } : { anchor: start, head: end });
    }
    if (result.length === 0) {
        const end = document.getLine(toLine).end;
        result.push({ anchor: end, head: end });
    }
    return result;
}

/* Whether two points are in the same cell of the same line, which makes a press with alt a click and not yet a box. */
export function sameCell(layout: EditorLayout, from: ContentPoint, to: ContentPoint): boolean {
    const document = layout.document;
    return (
        cellAt(layout, from.x) === cellAt(layout, to.x) &&
        document.positionAt(layout.hitTest(from.x, from.y)).line === document.positionAt(layout.hitTest(to.x, to.y)).line
    );
}
