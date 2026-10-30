import type { ActionRegistry } from '@ruimte/actions';
import i18next from 'i18next';
import { useToasts } from '@/state/toasts';

let loaded: ActionRegistry<void> | null = null;
const failures = new Set<() => void>();

/* Registration also covers Voice loading the registry with its workspace chunk. */
export function registerClientActionRegistry(registry: ActionRegistry<void>): ActionRegistry<void> {
    loaded = registry;

    return registry;
}

export function loadedClientActionRegistry(): ActionRegistry<void> | null {
    return loaded;
}

/* This load always comes from an action, even when a separate workspace prefetch is in flight. */
export async function loadClientActionRegistry(
    importRegistry: () => Promise<{ clientActions: ActionRegistry<void> }> = () => import('@/actions/client-action-registry')
): Promise<ActionRegistry<void>> {
    try {
        return (await importRegistry()).clientActions;
    } catch (error) {
        for (const listener of failures) {
            listener();
        }

        useToasts.getState().show({
            id: 'action-load-failed',
            kind: 'error',
            title: i18next.t('common:state.error'),
            description: i18next.t('common:state.actionLoadFailed')
        });

        throw error;
    }
}

export function onClientActionLoadError(listener: () => void): () => void {
    failures.add(listener);

    return () => failures.delete(listener);
}
