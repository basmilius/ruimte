import type { ContextSource } from '@ruimte/contracts';
import type { IndexedPlace } from '../projects/project-index.ts';

export interface ForkOriginReaders {
    /* The chat this one was forked from, or null when it is no fork. */
    forkedFrom(id: string): string | null;
    forksOf(id: string): string[];
    locate(id: string): IndexedPlace | null;
    titleFor(id: string): string | null;
}

/* Whether two chats of one project stand where no edge can join them: not both on the same canvas. */
function apart(one: IndexedPlace | null, other: IndexedPlace | null): boolean {
    return one !== null && other !== null && one.projectId === other.projectId && (one.canvasId === null || one.canvasId !== other.canvasId);
}

/*
 * What a fork or an original may read, with the other added when no edge could join them (a fork of
 * or into a view stands on no canvas beside its original). Two nodes on one canvas are left to their
 * edges, so a line a person removed there stays removed.
 */
export function withForkOrigin(targetId: string, sources: ContextSource[], readers: ForkOriginReaders): ContextSource[] {
    const target = readers.locate(targetId);
    const related = [readers.forkedFrom(targetId), ...readers.forksOf(targetId)].filter((id): id is string => id !== null);
    const added: ContextSource[] = [];
    for (const id of related) {
        if (sources.some((source) => source.id === id) || !apart(target, readers.locate(id))) {
            continue;
        }
        added.push({ id, kind: 'chat', title: readers.titleFor(id) ?? id });
    }
    return added.length === 0 ? sources : [...sources, ...added];
}
