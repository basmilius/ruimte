/*
 * Moving the keyboard to a row of the sidebar, which is where leaving the body of a standalone view
 * lands. The row is a DOM lookup rather than a store: the sidebar owns which rows exist, and a row
 * that is not there (the list is closed) simply takes no focus.
 */
export const focusViewRow = (viewId: string): void => {
    document.querySelector<HTMLElement>(`[data-sidebar-row="${CSS.escape(`view:${viewId}`)}"]`)?.focus();
};
