import type { ProjectSummary } from '@ruimte/contracts';
import { browserStorage, type LastProjectStorage } from './last-project';

const keyOf = (endpointId: string, projectId: string): string => `ruimte.closedProject.${JSON.stringify([endpointId, projectId])}`;

// An offline close belongs to this client. Reconnecting must not stop remote sessions later.
export const rememberClosedProject = (
    endpointId: string,
    projectId: string,
    storage: LastProjectStorage | null = browserStorage(),
    closedAt = Date.now()
): void => {
    storage?.setItem(keyOf(endpointId, projectId), String(closedAt));
};

export const forgetClosedProject = (endpointId: string, projectId: string, storage: LastProjectStorage | null = browserStorage()): void => {
    storage?.removeItem(keyOf(endpointId, projectId));
};

export const withClientClosedProject = (endpointId: string, summary: ProjectSummary, storage: LastProjectStorage | null = browserStorage()): ProjectSummary => {
    const raw = storage?.getItem(keyOf(endpointId, summary.projectId));
    const closedAt = raw == null ? NaN : Number(raw);
    return Number.isFinite(closedAt) ? { ...summary, closedAt } : summary;
};
