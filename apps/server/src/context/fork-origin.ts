import { isCanvasView, type ContextSource, type ProjectView } from '@ruimte/contracts';
import type { IndexedPlace } from '../projects/project-index.ts';

interface ForkOriginReaders {
    /* The chat this one was forked from, or null when it is no fork. */
    forkedFrom(id: string): string | null;
    forksOf(id: string): string[];
    locate(id: string): IndexedPlace | null;
    titleFor(id: string): string | null;
    viewsOf(projectId: string): readonly ProjectView[] | null;
}

/*
 * Whether two chats of one project stand where no edge can join them: not both nodes of their own on the
 * same canvas. A later chat of a design node stands on its canvas too, but no edge ends in it.
 */
function apart(one: { id: string; place: IndexedPlace | null }, other: { id: string; place: IndexedPlace | null }, readers: ForkOriginReaders): boolean {
    if (one.place === null || other.place === null || one.place.projectId !== other.place.projectId) {
        return false;
    }
    const canvasId = one.place.canvasId;
    if (canvasId === null || canvasId !== other.place.canvasId) {
        return true;
    }
    const canvas = readers.viewsOf(one.place.projectId)?.find((view) => view.id === canvasId);
    const nodes = canvas !== undefined && isCanvasView(canvas) ? canvas.nodes : [];

    return !nodes.some((node) => node.id === one.id) || !nodes.some((node) => node.id === other.id);
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
        if (sources.some((source) => source.id === id) || !apart({ id: targetId, place: target }, { id, place: readers.locate(id) }, readers)) {
            continue;
        }
        added.push({ id, kind: 'chat', title: readers.titleFor(id) ?? id });
    }
    return added.length === 0 ? sources : [...sources, ...added];
}
