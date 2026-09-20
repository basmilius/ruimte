/*
 * The text selection, as a context menu has to read it. The app has one selection at a time and a
 * menu belongs to the surface the click landed on, so both of these are scoped to an element.
 * A selection somewhere else is no selection this menu can copy.
 */

export const selectionWithin = (element: HTMLElement | null): string => {
    const selection = window.getSelection();
    if (!element || !selection || selection.isCollapsed || selection.rangeCount === 0) {
        return '';
    }
    return element.contains(selection.getRangeAt(0).commonAncestorContainer) ? selection.toString() : '';
};

export const selectAllWithin = (element: HTMLElement | null): void => {
    const selection = window.getSelection();
    if (!element || !selection) {
        return;
    }
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
};
