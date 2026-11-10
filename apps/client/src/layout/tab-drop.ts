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

/* Where the tab may stand: the strip, or the bar for a cell that has none. */
interface TabBounds {
    left: number;
    right: number;
}

/* The left edge of the gap at `gap`: the left of the tab that follows it, the right of the last tab for the end, and `fallback` for a strip with no tabs. */
export function gapLeft(rects: readonly { left: number; right: number }[], gap: number, fallback: number): number {
    return rects[gap]?.left ?? rects.at(-1)?.right ?? fallback;
}

/* Keeps a tab of `width` inside `bounds`; one wider than the bounds sits at their left edge. */
export function clampTabLeft(left: number, width: number, bounds: TabBounds): number {
    return Math.max(bounds.left, Math.min(left, bounds.right - width));
}

/* Cmd-click on macOS, Ctrl-click elsewhere (where Ctrl-click on a Mac is the context menu): open beside instead of over. */
export function wantsNewTab(event: { metaKey: boolean; ctrlKey: boolean }, apple: boolean): boolean {
    return apple ? event.metaKey : event.ctrlKey;
}
