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
