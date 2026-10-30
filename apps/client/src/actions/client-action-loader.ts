import type { ActionRegistry } from '@ruimte/actions';

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
export async function loadClientActionRegistry(): Promise<ActionRegistry<void>> {
    try {
        return (await import('@/actions/client-action-registry')).clientActions;
    } catch (error) {
        for (const listener of failures) {
            listener();
        }

        throw error;
    }
}

export function onClientActionLoadError(listener: () => void): () => void {
    failures.add(listener);

    return () => failures.delete(listener);
}
