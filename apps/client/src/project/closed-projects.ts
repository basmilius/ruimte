import type { ProjectSummary } from '@ruimte/contracts';
import { browserStorage, type LastProjectStorage } from './last-project';

function keyOf(endpointId: string, projectId: string): string {
    return `ruimte.closedProject.${JSON.stringify([endpointId, projectId])}`;
}

// An offline close belongs to this client. Reconnecting must not stop remote sessions later.
export function rememberClosedProject(
    endpointId: string,
    projectId: string,
    storage: LastProjectStorage | null = browserStorage(),
    closedAt = Date.now()
): void {
    storage?.setItem(keyOf(endpointId, projectId), String(closedAt));
}

export function forgetClosedProject(endpointId: string, projectId: string, storage: LastProjectStorage | null = browserStorage()): void {
    storage?.removeItem(keyOf(endpointId, projectId));
}

export function withClientClosedProject(endpointId: string, summary: ProjectSummary, storage: LastProjectStorage | null = browserStorage()): ProjectSummary {
    const raw = storage?.getItem(keyOf(endpointId, summary.projectId));
    const closedAt = raw == null ? NaN : Number(raw);
    return Number.isFinite(closedAt) ? { ...summary, closedAt } : summary;
}
