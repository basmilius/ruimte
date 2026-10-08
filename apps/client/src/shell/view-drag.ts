import { MAX_COLUMNS, type CellAt, type SplitZone } from '@/shell/split';
import type { PreviewRect } from '@/shell/tab-drop';

/*
 * What a dragged view carries. A row in the sidebar and a cell of the grid are the same gesture with
 * two different targets, and neither has to know where it lands: both write this type, and the
 * sidebar's own reorder and the grid's drop layer both listen for it.
 */
export const VIEW_DRAG_TYPE = 'application/x-ruimte-view';

/* The id of the view being dragged, or null for a drag that is about something else. */
export function draggedViewId(transfer: Pick<DataTransfer, 'types' | 'getData'>): string | null {
    if (!transfer.types.includes(VIEW_DRAG_TYPE)) {
        return null;
    }
    const id = transfer.getData(VIEW_DRAG_TYPE);
    return id === '' ? null : id;
}

/* Whether a drag carries a view at all. `getData` is empty during dragover, so the types decide. */
export function carriesView(transfer: Pick<DataTransfer, 'types'>): boolean {
    return transfer.types.includes(VIEW_DRAG_TYPE);
}

let held: string | null = null;
let heldWhole = false;
let heldTabWidth: number | null = null;

/*
 * Which view is being dragged right now. The payload itself is kept from the page until the drop,
 * so a target that has to decide whether it can take the drag, and draw that decision, cannot read
 * it. There is one pointer, so one drag: this is that drag, set where it starts and cleared where it
 * ends. Null for a drag that started outside this window, which the grid then simply refuses.
 */
export function dragging(): string | null {
    return held;
}

/*
 * `whole` is the bar of a tab host dragging, which carries every tab; a tab or a row in the sidebar carries its view alone.
 * `tabWidth` is the width of the tab being dragged, so a drop indicator can be as wide as the tab it stands for.
 */
export function setDragging(viewId: string | null, whole = false, tabWidth: number | null = null): void {
    held = viewId;
    heldWhole = viewId !== null && whole;
    heldTabWidth = viewId === null ? null : tabWidth;
}

/* The width of the tab being dragged, or null when the drag is not a tab. */
export function draggingTabWidth(): number | null {
    return heldTabWidth;
}

/* Whether the drag in progress takes the whole cell of the view it names, tabs and all. */
export function draggingWholeCell(): boolean {
    return heldWhole;
}

/*
 * Embedded pages absorb drag events before the cell sees them. Browser views, HTML previews and
 * chat visuals step out of the pointer's way for the whole drag (`body[data-dragging]` in
 * `styles.css`). An attribute rather than state, because the pages are not all in one tree.
 *
 * Watched on the window and not set by each source, since a source that forgets it leaves a drag
 * that works everywhere except over a page, which is the hardest kind of gap to find.
 */
export function watchDrags(): () => void {
    const mark = (dragging: boolean) => (): void => {
        document.body.toggleAttribute('data-dragging', dragging);
    };
    const begin = mark(true);
    const end = mark(false);
    // `dragenter` as well as `dragstart`: a drag out of the file manager begins outside this page.
    const starts = ['dragstart', 'dragenter'];
    const ends = ['dragend', 'drop'];
    for (const type of starts) {
        window.addEventListener(type, begin, true);
    }
    for (const type of ends) {
        window.addEventListener(type, end, true);
    }
    return () => {
        for (const type of starts) {
            window.removeEventListener(type, begin, true);
        }
        for (const type of ends) {
            window.removeEventListener(type, end, true);
        }
        end();
    };
}

let gridTakes = false;

/*
 * What stands in the cell reads this claim and leaves the drop alone, so one file never becomes
 * both a canvas node and a view. Like `dragging()`, there is only one claim for the one pointer.
 *
 * The cell sets it while the drag passes over it, before what is inside the cell has seen the event,
 * and clears it on the way out. Nothing here stops the event: a drop on a page mid-drag is decided
 * by the browser, and a handler that cuts the propagation short takes that decision away from it.
 */
export function gridTakesPath(): boolean {
    return gridTakes;
}

export function setGridTakesPath(takes: boolean): void {
    gridTakes = takes;
}

/*
 * How wide the edge zones are: a quarter of the axis keeps them usable in a narrow cell, and the
 * ceiling keeps the middle big enough in a cell that fills the window.
 */
const EDGE_SHARE = 0.25;
const EDGE_MAX = 96;

export interface Box {
    width: number;
    height: number;
}

/* Where in a cell the pointer is, in pixels from its top left corner. */
export interface Spot {
    x: number;
    y: number;
}

/*
 * Which of the five drop points the pointer is over. The edges split, the middle takes the place of
 * the view standing there, which is the point most apps leave out: opening a view where you want it
 * without making a cell for it.
 */
export function zoneAt(box: Box, spot: Spot): SplitZone {
    const edgeX = Math.min(box.width * EDGE_SHARE, EDGE_MAX);
    const edgeY = Math.min(box.height * EDGE_SHARE, EDGE_MAX);
    const left = spot.x;
    const right = box.width - spot.x;
    const top = spot.y;
    const bottom = box.height - spot.y;
    const sideways = Math.min(left, right) <= edgeX;
    const upright = Math.min(top, bottom) <= edgeY;
    if (!sideways && !upright) {
        return 'center';
    }
    // In a corner both answer, so they are compared as shares of their own strip: the strips differ
    // in width whenever the cell is not square, and the nearest edge in pixels is then the wrong one.
    if (sideways && (!upright || Math.min(left, right) / edgeX <= Math.min(top, bottom) / edgeY)) {
        return left <= right ? 'left' : 'right';
    }
    return top <= bottom ? 'up' : 'down';
}

/* A canvas keeps middle drops for nodes; a composer keeps every drop for attachments. */
export function pathZoneAt(box: Box, spot: Spot, taken: string | null = null): SplitZone | null {
    if (taken === 'all') {
        return null;
    }
    const zone = zoneAt(box, spot);
    return zone === 'center' && taken === 'middle' ? null : zone;
}

/*
 * The rectangle the view would take, as shares of the cell it is dropped on, with `column` saying
 * the shape reaches past the cell. Dropping on the side of a cell in a column of three gives a whole
 * new column rather than a neighbor for that one cell, and that is what has to be drawn: you aim at
 * a cell and get a column, so you have to see it before you let go.
 */
export interface DropShape {
    x: number;
    y: number;
    width: number;
    height: number;
    /* True when the shape is the height of the whole column instead of the cell's own. */
    column: boolean;
}

export function shapeOf(zone: SplitZone): DropShape {
    switch (zone) {
        case 'left':
            return { x: 0, y: 0, width: 0.5, height: 1, column: true };
        case 'right':
            return { x: 0.5, y: 0, width: 0.5, height: 1, column: true };
        case 'up':
            return { x: 0, y: 0, width: 1, height: 0.5, column: false };
        case 'down':
            return { x: 0, y: 0.5, width: 1, height: 0.5, column: false };
        default:
            return { x: 0, y: 0, width: 1, height: 1, column: false };
    }
}

/*
 * The rectangle of `shape` in the grid's coordinates, given the box of the column the cell stands in
 * and of the cell itself. The edges are rounded and not the sizes, so two rectangles that share an
 * edge keep sharing it and the outline stays on whole pixels.
 */
export function shapeRect(shape: DropShape, column: PreviewRect, cell: PreviewRect): PreviewRect {
    const left = Math.round(column.x + shape.x * column.width);
    const right = Math.round(column.x + (shape.x + shape.width) * column.width);
    const top = Math.round(shape.column ? column.y : cell.y + shape.y * cell.height);
    const bottom = Math.round(shape.column ? column.y + column.height : cell.y + (shape.y + shape.height) * cell.height);
    return { x: left, y: top, width: right - left, height: bottom - top };
}

/* A drop that lands on the cell the view already stands in, alone in the grid, changes nothing. */
export function isNowhereDrop(from: CellAt | null, at: CellAt, zone: SplitZone): boolean {
    return from !== null && from.column === at.column && from.cell === at.cell && zone === 'center';
}

/* The most columns there can be, for a caller that draws a hint about the limit. */
export { MAX_COLUMNS };
