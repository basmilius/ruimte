import type { ContextSource } from '@ruimte/contracts';
import type { IndexedPlace } from '../projects/project-index.ts';

export interface ForkOriginReaders {
    /* The chat this one was forked from, or null when it is no fork. */
    forkedFrom(id: string): string | null;
    locate(id: string): IndexedPlace | null;
    titleFor(id: string): string | null;
}

/*
 * What a fork may read, with its original added when no edge could carry it: a fork of a view, or
 * into a view, stands on no canvas beside its original, and a fork that could not read what came
 * before its cut would be less than the node fork it is. Two nodes on one canvas are left to their
 * edges, so a line a person removed there stays removed.
 */
export const withForkOrigin = (targetId: string, sources: ContextSource[], readers: ForkOriginReaders): ContextSource[] => {
    const originId = readers.forkedFrom(targetId);
    if (originId === null || sources.some((source) => source.id === originId)) {
        return sources;
    }
    const fork = readers.locate(targetId);
    const origin = readers.locate(originId);
    if (fork === null || origin === null || fork.projectId !== origin.projectId) {
        return sources;
    }
    if (fork.canvasId !== null && fork.canvasId === origin.canvasId) {
        return sources;
    }
    return [...sources, { id: originId, kind: 'chat', title: readers.titleFor(originId) ?? originId }];
};
