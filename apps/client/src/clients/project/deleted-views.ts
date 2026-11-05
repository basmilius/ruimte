import { z } from 'zod';
import { storedJson, type KeyValueStorage, type StoredValue } from '@/state/stored-json';

const DeletedViewsSchema = z.array(z.unknown()).transform((viewIds) => viewIds.filter((viewId): viewId is string => typeof viewId === 'string'));

function deletedViews(endpointId: string, projectId: string): StoredValue<string[], readonly string[]> {
    return storedJson(`ruimte.deletedViews.${JSON.stringify([endpointId, projectId])}`, DeletedViewsSchema);
}

/*
 * The views a person deleted from a project whose deletion may not have reached its file yet: still
 * waiting on the undo, or purged by a save that has not landed. A page can go before either ends,
 * and the next open finishes the deletion from here.
 */
export function readDeletedViews(endpointId: string, projectId: string, storage?: KeyValueStorage | null): string[] {
    return deletedViews(endpointId, projectId).read(storage) ?? [];
}

export function writeDeletedViews(endpointId: string, projectId: string, viewIds: readonly string[], storage?: KeyValueStorage | null): void {
    if (viewIds.length === 0) {
        deletedViews(endpointId, projectId).remove(storage);
        return;
    }
    deletedViews(endpointId, projectId).write(viewIds, storage);
}
