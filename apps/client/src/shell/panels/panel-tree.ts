import type { FileTree, FileTreeDirectoryHandle, FileTreeVisibleRow } from '@pierre/trees';
import { expansionChanges, type GitTreeRow } from '@/shell/panels/git-tree';

/* Opening a folder brings rows into view that may have to fold up in turn, so folding settles over
   a few passes; a tree that never settles stops here rather than looping. */
const EXPANSION_PASSES = 32;

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
 * A tree of changed files, over the shared rules. Every row is a change, so the news rides on the
 * parts of the decoration and a name keeps the panel's color. The decoration is laid open into the
 * row, so the parts stand apart by the row's own gap, and the counts are set in the mono face at the
 * floor this app puts under type, which keeps a column of them straight.
 */
export const CHANGE_TREE_CSS = `
    ${PANEL_TREE_CSS}
    [data-item-section="content"] { flex: 1 1 auto; }
    [data-item-section="decoration"], [data-item-section="decoration"] > span { display: contents; }
    [data-item-section="decoration"] span { flex: none; font-family: var(--font-mono); font-size: 12px; }
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

/* A chain of folders nothing branches in is one row, which stands for the deepest of them. */
export const pathOfRow = (row: FileTreeVisibleRow): string =>
    row.isFlattened ? (row.flattenedSegments?.findLast((segment) => segment.isTerminal)?.path ?? row.path) : row.path;

/* Every row the tree shows, which is every row but the ones a folded folder holds. */
export const visibleRows = (model: FileTree): GitTreeRow[] =>
    model.getVisibleRows(0, model.getVisibleCount()).map((row) => ({ path: pathOfRow(row), kind: row.kind, isExpanded: row.isExpanded }));

/* Folds the tree the way the collapse set says. */
export const applyExpansion = (model: FileTree, collapsed: ReadonlySet<string>, scope: string): void => {
    for (let pass = 0; pass < EXPANSION_PASSES; pass++) {
        const { collapse, expand } = expansionChanges(visibleRows(model), collapsed, scope);
        if (collapse.length === 0 && expand.length === 0) {
            return;
        }
        for (const path of collapse) {
            directoryHandle(model, path)?.collapse();
        }
        for (const path of expand) {
            directoryHandle(model, path)?.expand();
        }
    }
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

/*
 * The tree moves its focus and leaves the selection where it was, so the selection catches up, the
 * way a list of the OS moves both. Not in a microtask: one runs between this capture listener and
 * the tree's own handler, which moves the focus and stops the key, so it would select the row the
 * focus is leaving. `onMoved` hears the row the focus landed on, once it is another one.
 */
export const followFocus = (model: FileTree, onMoved?: (path: string) => void): void => {
    const from = model.getFocusedPath();
    window.setTimeout(() => {
        const path = model.getFocusedPath();
        selectOnly(model, path);
        if (path !== null && path !== from) {
            onMoved?.(path);
        }
    }, 0);
};

/* Gives one row the keyboard. A row that takes the focus tells the tree itself, so the tree's own
   arrows go on from there. */
export const focusRow = (model: FileTree, path: string): boolean => {
    const selector = `[data-type="item"][data-item-path="${CSS.escape(path)}"]:not([data-item-parked="true"])`;
    const row = model.getFileTreeContainer()?.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
    row?.focus();
    return row !== null;
};
