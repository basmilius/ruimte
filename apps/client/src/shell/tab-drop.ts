/* The horizontal extent of one tab in the strip, in the same coordinates as the pointer. */
export interface TabRect {
    left: number;
    right: number;
}

/*
 * The gap between tabs the pointer is nearest to, counted from the left: 0 is before the first tab and
 * `rects.length` after the last. The middle of a tab is where the gap moves to the other side of it.
 */
export function gapAt(rects: readonly TabRect[], x: number): number {
    const index = rects.findIndex((rect) => x < (rect.left + rect.right) / 2);
    return index === -1 ? rects.length : index;
}

/*
 * The position a drop at `gap` takes among the tabs that are left once the dragged one is lifted out, which
 * is what `dropAsTab` counts in. A tab dragged within its own strip leaves a hole behind it, so every gap
 * past it shifts down by one.
 */
export function positionAfterLifting(ids: readonly string[], gap: number, dragged: string | null): number {
    const from = dragged === null ? -1 : ids.indexOf(dragged);
    return from !== -1 && from < gap ? gap - 1 : gap;
}

/* The width of the indicator's tab when the drag is not a tab with a width of its own. */
export const DEFAULT_TAB_WIDTH = 128;

/* The gap above the indicator's tab, so it reads as a tab standing in the bar. */
export const TAB_TOP_INSET = 4;

/* The corner of the indicator's tab, and of its body, which is `rounded-sm` like the other drop indicator. */
export const TAB_RADIUS = 6;
export const BODY_RADIUS = 4;

/* The stroke is centered on the path, so the path runs half of it inside the box to keep the outer edge on it. */
export const DROP_STROKE = 2;

/* Where the tab may stand: the strip, or the bar for a cell that has none. */
export interface TabBounds {
    left: number;
    right: number;
}

/* The left edge of the gap at `gap`: the left of the tab that follows it, the right of the last tab for the end, and `fallback` for a strip with no tabs. */
export function gapLeft(rects: readonly TabRect[], gap: number, fallback: number): number {
    const after = rects[gap];
    if (after !== undefined) {
        return after.left;
    }
    return rects.length > 0 ? rects[rects.length - 1]!.right : fallback;
}

/* Keeps a tab of `width` inside `bounds`; one wider than the bounds sits at their left edge. */
export function clampTabLeft(left: number, width: number, bounds: TabBounds): number {
    return Math.max(bounds.left, Math.min(left, bounds.right - width));
}

/*
 * What the drop preview draws, in the grid's coordinates. A tab and a plain rectangle are the same
 * shape: a tab standing on a body, where the rectangle's tab has no height. `x` and `y` are the
 * top left of the outline's box, which for a tab is the cell with its bar.
 */
export interface DropPreviewShape {
    x: number;
    y: number;
    width: number;
    height: number;
    /* The part of the box above the body that the tab stands in; 0 for a rectangle. */
    barHeight: number;
    /* The tab's left edge and the top of its box, in the same coordinates as `x` and `y`. */
    tabLeft: number;
    tabWidth: number;
    tabTop: number;
    radius: number;
}

export interface PreviewRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

function coordinate(value: number): string {
    return String(Math.round(value * 100) / 100 + 0);
}

/*
 * The preview for a split or a trade: the rectangle as a tab with no height, parked just inside its
 * top left corner so the corner keeps its radius. It is where a tab target grows out of the rectangle.
 */
export function rectPreview({ x, y, width, height }: PreviewRect): DropPreviewShape {
    return { x, y, width, height, barHeight: 0, tabLeft: x + BODY_RADIUS, tabWidth: 0, tabTop: y, radius: TAB_RADIUS };
}

/* The preview for a tab: the tab and the body of the cell it lands in, `origin` being the cell's top left in the grid. */
export function tabPreview(drop: TabDrop, origin: { x: number; y: number }): DropPreviewShape {
    return {
        x: origin.x,
        y: origin.y,
        width: drop.width,
        height: drop.height,
        barHeight: drop.barHeight,
        tabLeft: origin.x + drop.left,
        tabWidth: drop.tabWidth,
        tabTop: origin.y + TAB_TOP_INSET,
        radius: TAB_RADIUS
    };
}

export function sameDropPreview(a: DropPreviewShape | null, b: DropPreviewShape | null): boolean {
    if (a === null || b === null) {
        return a === b;
    }
    return (
        a.x === b.x &&
        a.y === b.y &&
        a.width === b.width &&
        a.height === b.height &&
        a.barHeight === b.barHeight &&
        a.tabLeft === b.tabLeft &&
        a.tabWidth === b.tabWidth &&
        a.tabTop === b.tabTop &&
        a.radius === b.radius
    );
}

/*
 * The outline of a tab grown into the body under it, as one closed path so no line runs between the
 * two. The commands are the same whatever the numbers are (an arc of radius 0 is a straight line), so
 * the browser can move one outline into another with a transition on `d`. `inset` is how far the
 * path runs inside the box, which is half the stroke, so the outer edge of the line is on the box.
 */
export function dropPreviewPath({ x, y, width, height, barHeight, tabLeft, tabWidth, tabTop, radius }: DropPreviewShape, inset = DROP_STROKE / 2): string {
    const left = inset;
    const right = width - inset;
    const bottom = height - inset;
    const top = barHeight + inset;
    const tabStart = Math.max(left, Math.min(tabLeft - x + inset, right));
    const tabEnd = Math.max(tabStart, Math.min(tabLeft - x + tabWidth - inset, right));
    const tabY = Math.min(tabTop - y + inset, top);
    const tabCorner = Math.max(0, Math.min(radius - inset, (tabEnd - tabStart) / 2, top - tabY));
    const bodyCorner = Math.max(0, BODY_RADIUS - inset);
    // A tab flush with a side of the box continues that side, so the body has no corner there.
    const cornerLeft = Math.min(bodyCorner, tabStart - left);
    const cornerRight = Math.min(bodyCorner, right - tabEnd);
    const cornerBottom = Math.min(bodyCorner, (right - left) / 2, (bottom - top) / 2);
    const at = (px: number, py: number): string => `${coordinate(x + px)},${coordinate(y + py)}`;
    const arc = (corner: number, px: number, py: number): string => `A${coordinate(corner)},${coordinate(corner)} 0 0 1 ${at(px, py)}`;
    return [
        `M${at(left + cornerLeft, top)}`,
        `H${coordinate(x + tabStart)}`,
        `V${coordinate(y + tabY + tabCorner)}`,
        arc(tabCorner, tabStart + tabCorner, tabY),
        `H${coordinate(x + tabEnd - tabCorner)}`,
        arc(tabCorner, tabEnd, tabY + tabCorner),
        `V${coordinate(y + top)}`,
        `H${coordinate(x + right - cornerRight)}`,
        arc(cornerRight, right, top + cornerRight),
        `V${coordinate(y + bottom - cornerBottom)}`,
        arc(cornerBottom, right - cornerBottom, bottom),
        `H${coordinate(x + left + cornerBottom)}`,
        arc(cornerBottom, left, bottom - cornerBottom),
        `V${coordinate(y + top + cornerLeft)}`,
        arc(cornerLeft, left + cornerLeft, top),
        'Z'
    ].join(' ');
}

/* Where a view dragged over a cell's bar would land as a tab, in the cell's own coordinates. */
export interface TabDrop {
    /* The gap in the strip it lands in, counted in tabs from the left. */
    gap: number;
    left: number;
    tabWidth: number;
    /* The cell as a whole, bar included. */
    width: number;
    height: number;
    barHeight: number;
}

/* Cmd-click on macOS, Ctrl-click elsewhere (where Ctrl-click on a Mac is the context menu): open beside instead of over. */
export function wantsNewTab(event: { metaKey: boolean; ctrlKey: boolean }, apple: boolean): boolean {
    return apple ? event.metaKey : event.ctrlKey;
}
