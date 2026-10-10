import type { SplitLayout } from '@ruimte/contracts';
import { cellAt, cellViewIds, locateView, type CellAt } from '@/shell/split';
import { useDocument } from '@/state/document';
import { useFiles } from '@/state/files';

/*
 * Closing cells through the guards of their loose tabs, one after another. A person who keeps one at
 * its question stops the whole close. The pure grid operations (`closeCellAt` and the like) are the
 * document's; these run once every loose tab in their way is closed.
 */

/* What has a question to ask: a loose tab, and a database view of the project that holds edits nobody submitted. */
function looseKeysIn(ids: readonly string[]): string[] {
    const { tabs, unsubmitted } = useFiles.getState();
    return ids.filter((id) => unsubmitted[id] === true || tabs.some((tab) => tab.key === id));
}

/* The cell a view stands in now, since closing the tabs before it may have moved or removed cells. */
function cellOfView(viewId: string): CellAt | null {
    const { layout } = useDocument.getState();
    return layout === null ? null : locateView(layout, viewId);
}

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

/* Closes the loose tabs `closing` picks around the cell at `at`, then runs `close` on where that cell stands now. */
async function closeAroundGuarded(at: CellAt, closing: (layout: SplitLayout, keptIds: string[]) => string[], close: (now: CellAt) => void): Promise<boolean> {
    const { layout } = useDocument.getState();
    const kept = layout === null ? null : cellAt(layout, at);
    if (layout === null || kept === null) {
        return false;
    }
    if (!(await useFiles.getState().closeInOrder(looseKeysIn(closing(layout, cellViewIds(kept)))))) {
        return false;
    }
    const now = cellOfView(kept.viewId);
    if (now !== null) {
        close(now);
    }
    return true;
}

export function closeOtherCellsGuarded(at: CellAt): Promise<boolean> {
    return closeAroundGuarded(
        at,
        (layout, keptIds) => layout.columns.flatMap((column) => column.cells.flatMap(cellViewIds)).filter((id) => !keptIds.includes(id)),
        (now) => useDocument.getState().closeOtherCells(now)
    );
}

export function closeCellsRightOfGuarded(at: CellAt): Promise<boolean> {
    return closeAroundGuarded(
        at,
        (layout) => layout.columns.slice(at.column + 1).flatMap((column) => column.cells.flatMap(cellViewIds)),
        (now) => useDocument.getState().closeCellsRightOf(now)
    );
}
