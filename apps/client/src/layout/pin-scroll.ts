/*
 * Keeps a box that hides its overflow at its origin. Such a box still scrolls when something inside
 * takes the focus past its edge, and a canvas that scrolls slides its nodes out from under the pages
 * parked over them. `overflow: clip` would forbid the scroll, but it slowed the canvas down.
 */
export function pinScroll(element: HTMLElement): () => void {
    const reset = (): void => {
        element.scrollLeft = 0;
        element.scrollTop = 0;
    };
    element.addEventListener('scroll', reset);
    return () => element.removeEventListener('scroll', reset);
}
