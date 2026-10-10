/*
 * Where every cell of the grid stands on screen, by the view it holds. A browser page is parked outside
 * the React tree and moved into place by hand, since a <webview> that changes parent reloads, so the one
 * layer that parks pages asks here where a cell is.
 */
const cells = new Map<string, HTMLElement>();
const listeners = new Set<() => void>();

function announce(): void {
    for (const listener of [...listeners]) {
        listener();
    }
}

/* The cell's body, which is the box under its toolbar and the box a camera is measured against. */
export function registerCell(viewId: string, element: HTMLElement | null): void {
    if (element === null) {
        cells.delete(viewId);
    } else {
        cells.set(viewId, element);
    }
    announce();
}

export function cellElement(viewId: string): HTMLElement | null {
    return cells.get(viewId) ?? null;
}

/* Fires when a cell arrives, leaves or changes size, which a splitter drag does without any state. */
export function subscribeCells(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function cellsMoved(): void {
    return announce();
}
