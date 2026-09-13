/*
 * Where every cell of the grid stands on screen, by the view it holds. A browser page is not drawn
 * by React at all: it is an element parked outside the tree and moved into place by hand, so the one
 * layer that does that has to be able to ask where a cell is. The alternative, a parking layer per
 * cell, would move a <webview> between parents whenever a view changes cells, and a page that leaves
 * the document reloads.
 */
const cells = new Map<string, HTMLElement>();
const listeners = new Set<() => void>();

const announce = (): void => {
    for (const listener of [...listeners]) {
        listener();
    }
};

/* The cell's body, which is the box under its toolbar and the box a camera is measured against. */
export const registerCell = (viewId: string, element: HTMLElement | null): void => {
    if (element === null) {
        cells.delete(viewId);
    } else {
        cells.set(viewId, element);
    }
    announce();
};

export const cellElement = (viewId: string): HTMLElement | null => cells.get(viewId) ?? null;

/* Fires when a cell arrives, leaves or changes size, which a splitter drag does without any state. */
export const subscribeCells = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

export const cellsMoved = (): void => announce();
