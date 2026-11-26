import type { ProjectSummary } from '@ruimte/contracts';
import type { StorageTarget } from '@/state/other-windows';
import { browserStorage, type KeyValueStorage } from '@/state/stored-json';

const KEY_PREFIX = 'ruimte.closedProject.';

function keyOf(endpointId: string, projectId: string): string {
    return `${KEY_PREFIX}${JSON.stringify([endpointId, projectId])}`;
}

/*
 * Another window opened a project this client had closed. Its row here may already carry the close
 * again, since the machine's summary of that open can arrive before that window forgets it.
 */
export function followReopenedProjects(
    reopened: (endpointId: string) => void,
    target: StorageTarget | null = typeof window === 'undefined' ? null : window
): () => void {
    if (target === null) {
        return () => undefined;
    }
    const onStorage = (event: StorageEvent): void => {
        if (event.key === null || !event.key.startsWith(KEY_PREFIX) || event.newValue !== null) {
            return;
        }
        const [endpointId] = JSON.parse(event.key.slice(KEY_PREFIX.length)) as [string, string];
        reopened(endpointId);
    };
    target.addEventListener('storage', onStorage);
    return () => target.removeEventListener('storage', onStorage);
}

// An offline close belongs to this client. Reconnecting must not stop remote sessions later.
export function rememberClosedProject(endpointId: string, projectId: string, storage: KeyValueStorage | null = browserStorage(), closedAt = Date.now()): void {
    storage?.setItem(keyOf(endpointId, projectId), String(closedAt));
}

export function forgetClosedProject(endpointId: string, projectId: string, storage: KeyValueStorage | null = browserStorage()): void {
    storage?.removeItem(keyOf(endpointId, projectId));
}

export function withClientClosedProject(endpointId: string, summary: ProjectSummary, storage: KeyValueStorage | null = browserStorage()): ProjectSummary {
    const raw = storage?.getItem(keyOf(endpointId, summary.projectId));
    const closedAt = raw == null ? NaN : Number(raw);
    return Number.isFinite(closedAt) ? { ...summary, closedAt } : summary;
}
