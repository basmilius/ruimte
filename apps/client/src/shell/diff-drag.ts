import { ProjectFileTabViewSchema, type ProjectFileTabView } from '@ruimte/contracts';
import { FILES_VIEW_ID } from '@/shell/client-cells';
import { setDragging, VIEW_DRAG_TYPE } from '@/shell/view-drag';

/*
 * A change dragged out of the git panel. It travels as the files view, so the grid draws and places
 * it like any view, and carries the diff tab that view opens on. Every change shares that one tab,
 * so whichever file is dragged, the changes go where it is dropped.
 */
export const DIFF_DRAG_TYPE = 'application/x-ruimte-diff';

export interface DraggedDiff {
    path: string;
    view: ProjectFileTabView;
}

export function startDiffDrag(transfer: DataTransfer, diff: DraggedDiff): void {
    transfer.setData(VIEW_DRAG_TYPE, FILES_VIEW_ID);
    transfer.setData(DIFF_DRAG_TYPE, JSON.stringify(diff));
    transfer.effectAllowed = 'move';
    setDragging(FILES_VIEW_ID);
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
