import { ProjectFileTabViewSchema, type ProjectFileTabView } from '@ruimte/contracts';
import { setDragging, VIEW_DRAG_TYPE } from '@/shell/view-drag';

/*
 * A change dragged out of the git panel. It travels as a view drag of its own id, so the grid draws
 * where it would land like it does for any view, and carries the diff the cell opens as a loose tab.
 * Every change shares one diff tab, so whichever file is dragged, the changes go where it is dropped.
 */
export const DIFF_DRAG_TYPE = 'application/x-ruimte-diff';

/* What the drag says it is moving: no view of the grid, so a drop never takes a cell along. */
export const DIFF_DRAG_ID = 'diff';

export interface DraggedDiff {
    path: string;
    view: ProjectFileTabView;
}

export function startDiffDrag(transfer: DataTransfer, diff: DraggedDiff): void {
    transfer.setData(VIEW_DRAG_TYPE, DIFF_DRAG_ID);
    transfer.setData(DIFF_DRAG_TYPE, JSON.stringify(diff));
    transfer.effectAllowed = 'move';
    setDragging(DIFF_DRAG_ID);
}

/* `getData` is empty during dragover, so the types decide. */
export function carriesDiff(transfer: Pick<DataTransfer, 'types'>): boolean {
    return transfer.types.includes(DIFF_DRAG_TYPE);
}

/* Null for a drag without a change, or with one another window wrote in a shape this one cannot read. */
export function droppedDiff(transfer: Pick<DataTransfer, 'types' | 'getData'>): DraggedDiff | null {
    if (!carriesDiff(transfer)) {
        return null;
    }
    try {
        const raw = JSON.parse(transfer.getData(DIFF_DRAG_TYPE)) as { path?: unknown; view?: unknown };
        const view = ProjectFileTabViewSchema.safeParse(raw.view);
        return typeof raw.path === 'string' && raw.path !== '' && view.success ? { path: raw.path, view: view.data } : null;
    } catch {
        return null;
    }
}
