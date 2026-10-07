import { cellAt, cellViewIds, locateView, type CellAt } from '@/shell/split';
import { useDocument } from '@/state/document';
import { useFiles } from '@/state/files';

/*
 * Closing cells through the guards of their loose tabs: a file with unsaved changes is saved first and a
 * table with edits nobody submitted asks first. The tabs close one after another, and a person who keeps
 * one at its question stops the whole close, which then leaves the cell standing with what is left.
 * The pure grid operations are the document's (`closeCellAt` and the like); these run once every loose
 * tab in their way is closed.
 */

function looseKeysIn(ids: readonly string[]): string[] {
    const pool = useFiles.getState().tabs;
    return ids.filter((id) => pool.some((tab) => tab.key === id));
}

/* The cell a view stands in now, since closing the tabs before it may have moved or removed cells. */
function cellOfView(viewId: string): CellAt | null {
    const { layout } = useDocument.getState();
    return layout === null ? null : locateView(layout, viewId);
}

/* True when the cell is gone, or was already the last one, which stays. */
export async function closeCellGuarded(at: CellAt): Promise<boolean> {
    const { layout } = useDocument.getState();
    const cell = layout === null ? null : cellAt(layout, at);
    if (cell === null) {
        return false;
    }
    const ids = cellViewIds(cell);
    const loose = looseKeysIn(ids);
    if (!(await useFiles.getState().closeInOrder(loose))) {
        return false;
    }
    // A cell of loose tabs only went with its last one; one that holds a view of the project too still stands.
    const anchor = ids.find((id) => !loose.includes(id));
    const now = anchor === undefined ? null : cellOfView(anchor);
    if (now !== null) {
        useDocument.getState().closeCellAt(now);
    }
    return true;
}

export async function closeOtherCellsGuarded(at: CellAt): Promise<boolean> {
    const { layout } = useDocument.getState();
    const kept = layout === null ? null : cellAt(layout, at);
    if (layout === null || kept === null) {
        return false;
    }
    const keptIds = cellViewIds(kept);
    const others = layout.columns.flatMap((column) => column.cells.flatMap(cellViewIds)).filter((id) => !keptIds.includes(id));
    if (!(await useFiles.getState().closeInOrder(looseKeysIn(others)))) {
        return false;
    }
    const now = cellOfView(kept.viewId);
    if (now !== null) {
        useDocument.getState().closeOtherCells(now);
    }
    return true;
}

export async function closeCellsRightOfGuarded(at: CellAt): Promise<boolean> {
    const { layout } = useDocument.getState();
    const kept = layout === null ? null : cellAt(layout, at);
    if (layout === null || kept === null) {
        return false;
    }
    const right = layout.columns.slice(at.column + 1).flatMap((column) => column.cells.flatMap(cellViewIds));
    if (!(await useFiles.getState().closeInOrder(looseKeysIn(right)))) {
        return false;
    }
    const now = cellOfView(kept.viewId);
    if (now !== null) {
        useDocument.getState().closeCellsRightOf(now);
    }
    return true;
}
