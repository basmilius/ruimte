import type { TableRef } from '@adecore/database';
import type { TableKind } from '@adecore/database/protocol';
import { ProjectDatabaseViewSchema } from '@ruimte/contracts';
import { applyDatabaseAction, databaseViewFor, type DatabaseTabAction } from '@/database/tabs';
import { setDragging, VIEW_DRAG_TYPE } from '@/shell/view-drag';
import { useDocument } from '@/state/document';
import { useFiles } from '@/state/files';

export const DATABASE_DRAG_TYPE = 'application/x-ruimte-database-table';
const tableSchema = ProjectDatabaseViewSchema.pick({ connectionId: true, schema: true, table: true, tableKind: true });

export function startDatabaseDrag(transfer: Pick<DataTransfer, 'setData' | 'effectAllowed'>, ref: TableRef, tableKind: TableKind): void {
    const action: DatabaseTabAction = { kind: 'open-table', ref, view: 'data', tableKind };
    const kept = databaseViewFor(useDocument.getState().views, action);
    // Computing a key must not open the table or move the focus before the drop.
    const key = kept?.id ?? applyDatabaseAction(useFiles.getState(), action, () => 'dragged-table').active!;
    transfer.setData(VIEW_DRAG_TYPE, key);
    transfer.setData(DATABASE_DRAG_TYPE, JSON.stringify({ ...ref, tableKind }));
    transfer.effectAllowed = 'move';
    setDragging(key);
}

export function carriesDatabase(transfer: Pick<DataTransfer, 'types'>): boolean {
    return transfer.types.includes(DATABASE_DRAG_TYPE);
}

export function droppedDatabase(transfer: Pick<DataTransfer, 'types' | 'getData'>): DatabaseTabAction | null {
    if (!carriesDatabase(transfer)) {
        return null;
    }
    try {
        const result = tableSchema.safeParse(JSON.parse(transfer.getData(DATABASE_DRAG_TYPE)));
        if (!result.success) {
            return null;
        }
        const { tableKind, ...ref } = result.data;
        return { kind: 'open-table', ref, view: 'data', ...(tableKind === undefined ? {} : { tableKind }) };
    } catch {
        return null;
    }
}
