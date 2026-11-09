import type { ActionRegistry } from '@ruimte/actions';
import i18next from 'i18next';
import { useToasts } from '@/state/toasts';

type ImportRegistry = () => Promise<ActionRegistry<void>>;

let loaded: ActionRegistry<void> | null = null;
let importer: ImportRegistry | null = null;
const failures = new Set<() => void>();

/* Handed over by `wiring/client-hooks.ts`: the start screen runs no action, so the registry loads with the first one. */
export function provideClientActionLoader(importRegistry: ImportRegistry): void {
    importer = importRegistry;
}

/* A registry built up front, as the tests do, never goes through a load. */
export function registerClientActionRegistry(registry: ActionRegistry<void>): ActionRegistry<void> {
    loaded = registry;

    return registry;
}

export function loadedClientActionRegistry(): ActionRegistry<void> | null {
    return loaded;
}

/* This load always comes from an action, even when a separate workspace prefetch is in flight. */
export async function loadClientActionRegistry(importRegistry: ImportRegistry | null = importer): Promise<ActionRegistry<void>> {
    if (importRegistry === null) {
        throw new Error('No action registry is installed: run installClientHooks (wiring/client-hooks.ts) before the first action.');
    }
    try {
        return registerClientActionRegistry(await importRegistry());
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
