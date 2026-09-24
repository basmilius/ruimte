import { browserStorage, type LastProjectStorage } from './last-project';

const keyOf = (endpointId: string, projectId: string): string => `ruimte.deletedViews.${JSON.stringify([endpointId, projectId])}`;

/*
 * The views a person deleted from a project whose deletion may not have reached its file yet: still
 * waiting on the undo, or purged by a save that has not landed. A page can go before either ends,
 * and the next open finishes the deletion from here.
 */
export const readDeletedViews = (endpointId: string, projectId: string, storage: LastProjectStorage | null = browserStorage()): string[] => {
    const raw = storage?.getItem(keyOf(endpointId, projectId)) ?? null;
    if (raw === null) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed) ? parsed.filter((viewId): viewId is string => typeof viewId === 'string') : [];
    } catch {
        return [];
    }
};

export const writeDeletedViews = (
    endpointId: string,
    projectId: string,
    viewIds: readonly string[],
    storage: LastProjectStorage | null = browserStorage()
): void => {
    if (viewIds.length === 0) {
        storage?.removeItem(keyOf(endpointId, projectId));
        return;
    }
    storage?.setItem(keyOf(endpointId, projectId), JSON.stringify(viewIds));
};
