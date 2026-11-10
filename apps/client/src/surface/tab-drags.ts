import type { CellAt, SplitZone } from '@/layout/split';
import { createRegistry } from '@/registry/create-registry';

/*
 * A drag that a cell takes as a tab of its own: a table, an artifact, a change. A feature registers
 * what it drags, so the grid that takes the drop imports none of them.
 */
export interface TabDragKind {
    readonly id: string;
    /* `getData` is empty during dragover, so the types decide. */
    carries(transfer: Pick<DataTransfer, 'types'>): boolean;
    /* Opens the dragged thing as a tab of the cell, or beside it for a side zone, at the position `indexFor` gives for the key the tab will have; false when the payload cannot be read. */
    drop(transfer: DataTransfer, at: CellAt, zone: SplitZone, indexFor: (movingKey: string) => number | null): boolean;
}

export const tabDragRegistry = createRegistry<TabDragKind>('tab drag');

export function carriesTabDrag(transfer: Pick<DataTransfer, 'types'>): boolean {
    return tabDragRegistry.all().some((kind) => kind.carries(transfer));
}

export function takeTabDrop(transfer: DataTransfer, at: CellAt, zone: SplitZone, indexFor: (movingKey: string) => number | null = () => null): boolean {
    return tabDragRegistry.all().some((kind) => kind.carries(transfer) && kind.drop(transfer, at, zone, indexFor));
}
