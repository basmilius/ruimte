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

/* Cmd-click on macOS, Ctrl-click elsewhere (where Ctrl-click on a Mac is the context menu): open beside instead of over. */
export function wantsNewTab(event: { metaKey: boolean; ctrlKey: boolean }, apple: boolean): boolean {
    return apple ? event.metaKey : event.ctrlKey;
}
