import type { FileTree, FileTreeDirectoryHandle } from '@pierre/trees';

/*
 * What both panels put over the tree's own stylesheet.
 *
 * A name is cut at its end here. The tree splits it before the extension and keeps that tail, which
 * swallows the dot in the marker. Laying the halves flat again has to reach every part of them, a
 * name too short to be split included: a cell hidden inside a grid that stays a grid leaves the
 * name in a column no pixels wide. The chevron is drawn smaller than the tree's own 16, which is
 * the size of a file icon and more than a row needs for the thing that only turns.
 */
export const PANEL_TREE_CSS = `
    [data-icon-name="file-tree-icon-chevron"] { width: 12px; height: 12px; }
    [data-item-section="content"] { white-space: nowrap; }
    [data-item-section="content"] :where([data-truncate-group-container], [data-truncate-group-container] div, [data-truncate-container], [data-truncate-container] div) { display: inline; }
    [data-item-section="content"] [data-truncate-content] { direction: ltr; }
    [data-item-section="content"] :where([data-truncate-content="overflow"], [data-truncate-marker-cell], [data-truncate-fill]) { display: none; }
`;

/*
 * The height of a row, over the 24 of the tree's compact density. A row divides what it has left
 * over the text evenly, so an even height splits the odd box of a 13px face over two half pixels
 * and the letters land under the middle. An odd height splits it whole; the icons pay the half
 * pixel instead, and a filled glyph carries that where a letter does not.
 */
export const PANEL_TREE_ROW_HEIGHT = 25;

/* The tree's own handle type is a union whose two halves TypeScript cannot tell apart by method. */
export const directoryHandle = (model: FileTree, path: string): FileTreeDirectoryHandle | null => {
    const item = model.getItem(path);
    return item?.isDirectory() ? (item as FileTreeDirectoryHandle) : null;
};

export const resetExpandedPaths = (model: FileTree, paths: readonly string[], expanded: ReadonlySet<string>): void => {
    model.resetPaths(paths, { initialExpandedPaths: [...expanded] });
    // @pierre/trees beta.6 restores expansion with its default sort, so custom sorting needs a second pass.
    for (const path of expanded) {
        directoryHandle(model, path)?.expand();
    }
};

/* The row a composed event came out of. The rows live in a shadow root, so the path is somewhere on
   the way up and never on the target React hands over. */
export const rowPathOf = (event: { nativeEvent: Event }): string | null => {
    for (const node of event.nativeEvent.composedPath()) {
        const path = node instanceof HTMLElement ? node.dataset.itemPath : undefined;
        if (path) {
            return path;
        }
    }
    return null;
};

/* The rows a context menu acts on: the whole selection when the row is part of one, else the row. */
export const menuTargetsOf = (row: string, selected: readonly string[]): string[] => (selected.includes(row) && selected.length > 1 ? [...selected] : [row]);

/* A click that extends the selection, which the tree handles and a panel must not read as "open this". */
export const extendsSelection = (event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): boolean => event.shiftKey || event.metaKey || event.ctrlKey;

/* The keys that move the tree's focus without extending the selection. */
const FOCUS_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

export const movesFocus = (event: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean =>
    FOCUS_KEYS.has(event.key) && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;

export const selectOnly = (model: FileTree, path: string | null): void => {
    for (const selected of model.getSelectedPaths()) {
        if (selected !== path) {
            model.getItem(selected)?.deselect();
        }
    }
    const item = path === null ? null : model.getItem(path);
    if (item && !item.isSelected()) {
        item.select();
    }
};

/* The tree moves its focus while the key is still being dispatched and leaves the selection where it
   was, so the selection catches up once the dispatch is over, the way a list of the OS moves both. */
export const followFocus = (model: FileTree): void => {
    queueMicrotask(() => selectOnly(model, model.getFocusedPath()));
};

/* Gives one row the keyboard. A row that takes the focus tells the tree itself, so the tree's own
   arrows go on from there. */
export const focusRow = (model: FileTree, path: string): boolean => {
    const selector = `[data-type="item"][data-item-path="${CSS.escape(path)}"]:not([data-item-parked="true"])`;
    const row = model.getFileTreeContainer()?.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
    row?.focus();
    return row !== null;
};
