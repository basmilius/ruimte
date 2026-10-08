import { describe, expect, test } from 'bun:test';
import {
    carriesView,
    draggedViewId,
    dragging,
    draggingTabWidth,
    draggingWholeCell,
    pathZoneAt,
    setDragging,
    shapeOf,
    shapeRect,
    VIEW_DRAG_TYPE,
    zoneAt
} from './view-drag';

function transfer(types: string[], data: Record<string, string> = {}): Pick<DataTransfer, 'types' | 'getData'> {
    return {
        types,
        getData: (type: string) => data[type] ?? ''
    };
}

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

describe('which drag is in progress', () => {
    test('a drag of a host by its bar carries the whole cell, and the end of any drag clears it', () => {
        setDragging('view-1', true);
        expect(dragging()).toBe('view-1');
        expect(draggingWholeCell()).toBe(true);
        setDragging('view-2');
        expect(draggingWholeCell()).toBe(false);
        setDragging(null, true);
        expect(dragging()).toBeNull();
        expect(draggingWholeCell()).toBe(false);
    });

    test('a dragged tab keeps its width until the drag ends', () => {
        setDragging('view-1', false, 96);
        expect(draggingTabWidth()).toBe(96);
        setDragging('view-2');
        expect(draggingTabWidth()).toBeNull();
        setDragging('view-3', false, 96);
        setDragging(null);
        expect(draggingTabWidth()).toBeNull();
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

describe('where a file from the panel lands', () => {
    const box = { width: 800, height: 600 };

    test('the middle replaces the view instead of creating a split', () => {
        expect(pathZoneAt(box, { x: 390, y: 300 })).toBe('center');
        expect(pathZoneAt(box, { x: 410, y: 300 })).toBe('center');
        expect(pathZoneAt({ width: 200, height: 160 }, { x: 100, y: 80 })).toBe('center');
    });

    test('each edge still makes a split, including around a canvas', () => {
        for (const taken of [null, 'middle']) {
            expect(pathZoneAt(box, { x: 10, y: 300 }, taken)).toBe('left');
            expect(pathZoneAt(box, { x: 790, y: 300 }, taken)).toBe('right');
            expect(pathZoneAt(box, { x: 400, y: 10 }, taken)).toBe('up');
            expect(pathZoneAt(box, { x: 400, y: 590 }, taken)).toBe('down');
        }
    });

    test('the canvas receives its middle drop and a composer receives even its edge drops', () => {
        expect(pathZoneAt(box, { x: 400, y: 300 }, 'middle')).toBeNull();
        expect(pathZoneAt(box, { x: 400, y: 300 }, 'all')).toBeNull();
        expect(pathZoneAt(box, { x: 10, y: 300 }, 'all')).toBeNull();
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

describe('shapeRect', () => {
    const column = { x: 100, y: 0, width: 400, height: 600 };
    const cell = { x: 100, y: 200, width: 400, height: 301 };

    test('a side is the half of the column, over its whole height', () => {
        expect(shapeRect(shapeOf('left'), column, cell)).toEqual({ x: 100, y: 0, width: 200, height: 600 });
        expect(shapeRect(shapeOf('right'), column, cell)).toEqual({ x: 300, y: 0, width: 200, height: 600 });
    });

    test('up and down are the half of the cell, rounded on the edges so the halves meet', () => {
        const up = shapeRect(shapeOf('up'), column, cell);
        const down = shapeRect(shapeOf('down'), column, cell);
        expect(up).toEqual({ x: 100, y: 200, width: 400, height: 151 });
        expect(down).toEqual({ x: 100, y: 351, width: 400, height: 150 });
        expect(up.y + up.height).toBe(down.y);
    });

    test('the middle is the cell', () => {
        expect(shapeRect(shapeOf('center'), column, cell)).toEqual(cell);
    });
});
