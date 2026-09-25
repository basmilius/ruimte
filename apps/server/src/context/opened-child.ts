import type { ContextSource } from '@ruimte/contracts';

export interface OpenedChildReaders {
    /* Who made a node, as the lineage under `$RUIMTE_HOME` wrote it down; null for one a person made. */
    madeBy(nodeId: string): string | null;
    agentSource(id: string): ContextSource | null;
}

/*
 * The terminal or chat under `sourceId` when `readerId` opened it itself: a parent reads its own child
 * with no line from it, by the same lineage `answer` checks. A line would let any two agents read each
 * other, and a grandchild is its own parent's to read, so nothing wider than that one step opens here.
 */
export const openedChildSource = (readerId: string, sourceId: string, readers: OpenedChildReaders): ContextSource | null =>
    readers.madeBy(sourceId) === readerId ? readers.agentSource(sourceId) : null;
