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

export interface TabDropShape {
    /* The cell as a whole, bar included. */
    width: number;
    height: number;
    barHeight: number;
    /* The tab in the cell's own coordinates: its left edge and the top of its box. */
    tabLeft: number;
    tabWidth: number;
    tabTop: number;
    radius: number;
    /* How far the path runs inside the box, which is half the stroke. */
    inset?: number;
}

function coordinate(value: number): string {
    return String(Math.round(value * 100) / 100 + 0);
}

/*
 * The outline of a tab grown into the body of its cell: the tab stands in the bar and the body fills
 * everything under it, as one closed path so no line runs between the two. The commands are the same
 * whatever the numbers are (an arc of radius 0 is a straight line), which lets the browser move the
 * tab with a transition on `d`.
 */
export function tabDropPath({ width, height, barHeight, tabLeft, tabWidth, tabTop, radius, inset = 0 }: TabDropShape): string {
    const left = inset;
    const right = width - inset;
    const bottom = height - inset;
    const top = barHeight + inset;
    const tabStart = Math.max(left, Math.min(tabLeft + inset, right));
    const tabEnd = Math.max(tabStart, Math.min(tabLeft + tabWidth - inset, right));
    const tabY = Math.min(tabTop + inset, top);
    const tabCorner = Math.max(0, Math.min(radius - inset, (tabEnd - tabStart) / 2, top - tabY));
    const bodyCorner = Math.max(0, BODY_RADIUS - inset);
    // A tab flush with a side of the cell continues that side, so the body has no corner there.
    const cornerLeft = Math.min(bodyCorner, tabStart - left);
    const cornerRight = Math.min(bodyCorner, right - tabEnd);
    const cornerBottom = Math.min(bodyCorner, (right - left) / 2, (bottom - top) / 2);
    const arc = (corner: number, x: number, y: number): string => `A${coordinate(corner)},${coordinate(corner)} 0 0 1 ${coordinate(x)},${coordinate(y)}`;
    return [
        `M${coordinate(left + cornerLeft)},${coordinate(top)}`,
        `H${coordinate(tabStart)}`,
        `V${coordinate(tabY + tabCorner)}`,
        arc(tabCorner, tabStart + tabCorner, tabY),
        `H${coordinate(tabEnd - tabCorner)}`,
        arc(tabCorner, tabEnd, tabY + tabCorner),
        `V${coordinate(top)}`,
        `H${coordinate(right - cornerRight)}`,
        arc(cornerRight, right, top + cornerRight),
        `V${coordinate(bottom - cornerBottom)}`,
        arc(cornerBottom, right - cornerBottom, bottom),
        `H${coordinate(left + cornerBottom)}`,
        arc(cornerBottom, left, bottom - cornerBottom),
        `V${coordinate(top + cornerLeft)}`,
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

export function sameTabDrop(a: TabDrop | null, b: TabDrop | null): boolean {
    if (a === null || b === null) {
        return a === b;
    }
    return a.gap === b.gap && a.left === b.left && a.tabWidth === b.tabWidth && a.width === b.width && a.height === b.height && a.barHeight === b.barHeight;
}

/* Cmd-click on macOS, Ctrl-click elsewhere (where Ctrl-click on a Mac is the context menu): open beside instead of over. */
export function wantsNewTab(event: { metaKey: boolean; ctrlKey: boolean }, apple: boolean): boolean {
    return apple ? event.metaKey : event.ctrlKey;
}
