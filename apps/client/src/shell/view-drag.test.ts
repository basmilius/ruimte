import { describe, expect, test } from 'bun:test';
import { carriesView, draggedViewId, shapeOf, VIEW_DRAG_TYPE, zoneAt } from './view-drag';

const transfer = (types: string[], data: Record<string, string> = {}): Pick<DataTransfer, 'types' | 'getData'> => ({
    types,
    getData: (type: string) => data[type] ?? ''
});

describe('what a drag carries', () => {
    test('a view drag is the one with this type on it', () => {
        expect(draggedViewId(transfer([VIEW_DRAG_TYPE], { [VIEW_DRAG_TYPE]: 'view-1' }))).toBe('view-1');
        expect(draggedViewId(transfer(['text/plain'], { 'text/plain': 'view-1' }))).toBeNull();
    });

    test('an empty payload is no view, which is what a browser hands back for a foreign drag', () => {
        expect(draggedViewId(transfer([VIEW_DRAG_TYPE]))).toBeNull();
    });

    test('the types alone answer during dragover, where the payload is kept from the page', () => {
        expect(carriesView(transfer([VIEW_DRAG_TYPE]))).toBe(true);
        expect(carriesView(transfer(['Files']))).toBe(false);
    });
});

describe('the five drop points of a cell', () => {
    const box = { width: 800, height: 600 };

    test('the middle is everything the edges do not take', () => {
        expect(zoneAt(box, { x: 400, y: 300 })).toBe('center');
        expect(zoneAt(box, { x: 200, y: 300 })).toBe('center');
    });

    test('each edge answers for its own strip', () => {
        expect(zoneAt(box, { x: 10, y: 300 })).toBe('left');
        expect(zoneAt(box, { x: 790, y: 300 })).toBe('right');
        expect(zoneAt(box, { x: 400, y: 10 })).toBe('up');
        expect(zoneAt(box, { x: 400, y: 590 })).toBe('down');
    });

    test('a corner belongs to the edge it is nearest to', () => {
        expect(zoneAt(box, { x: 5, y: 20 })).toBe('left');
        expect(zoneAt(box, { x: 20, y: 5 })).toBe('up');
    });

    test('the strips are capped, so a cell that fills the window keeps a large middle', () => {
        const wide = { width: 2000, height: 1200 };
        expect(zoneAt(wide, { x: 120, y: 600 })).toBe('center');
        expect(zoneAt(wide, { x: 90, y: 600 })).toBe('left');
    });

    test('a quarter of the axis keeps them reachable in a narrow cell', () => {
        const narrow = { width: 200, height: 160 };
        expect(zoneAt(narrow, { x: 20, y: 80 })).toBe('left');
        expect(zoneAt(narrow, { x: 100, y: 80 })).toBe('center');
    });
});

describe('the shape the indicator draws', () => {
    test('a side reaches the whole height, because a side drop makes a column', () => {
        expect(shapeOf('left')).toEqual({ x: 0, y: 0, width: 0.5, height: 1, column: true });
        expect(shapeOf('right')).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1, column: true });
    });

    test('up and down stay inside the cell, because they make a cell', () => {
        expect(shapeOf('up')).toMatchObject({ height: 0.5, column: false });
        expect(shapeOf('down')).toMatchObject({ y: 0.5, column: false });
    });

    test('the middle is the whole cell', () => {
        expect(shapeOf('center')).toEqual({ x: 0, y: 0, width: 1, height: 1, column: false });
    });
});
