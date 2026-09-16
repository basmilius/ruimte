import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';

const LAST_PROJECT_KEY = 'ruimte.lastProject';

export type LastProjectStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/* The last project the window had open, which is what a cold start opens again. */
export interface LastProject {
    endpointId: string;
    projectId: string;
}

export const browserStorage = (): LastProjectStorage | null => (typeof localStorage === 'undefined' ? null : localStorage);

const isLastProject = (value: unknown): value is LastProject =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as LastProject).endpointId === 'string' &&
    typeof (value as LastProject).projectId === 'string';

/*
 * Two older shapes are read as well: a record that also kept a project per machine, whose `last` is
 * still the answer, and the bare project id this key held before a client knew more than one daemon,
 * which can only have been this machine's. A record with a project per machine and no `last` says
 * nothing about which of them was on screen, so it opens nothing.
 */
export const readLastProject = (storage: LastProjectStorage | null): LastProject | null => {
    const raw = storage?.getItem(LAST_PROJECT_KEY) ?? null;
    if (raw === null) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (typeof parsed === 'object' && parsed !== null) {
            const last = (parsed as { last?: unknown }).last;
            return isLastProject(last) ? { endpointId: last.endpointId, projectId: last.projectId } : null;
        }
    } catch {
        // A bare project id, written before this key was a record.
    }
    return raw === '' ? null : { endpointId: LOCAL_ENDPOINT_ID, projectId: raw };
};

const write = (storage: LastProjectStorage | null, last: LastProject | null): void => {
    storage?.setItem(LAST_PROJECT_KEY, JSON.stringify({ last }));
};

/* The project the window has open now; null once that project on that machine is closed. */
export const rememberProject = (endpointId: string, projectId: string | null, storage: LastProjectStorage | null = browserStorage()): void => {
    if (projectId !== null) {
        write(storage, { endpointId, projectId });
        return;
    }
    if (readLastProject(storage)?.endpointId === endpointId) {
        write(storage, null);
    }
};

/* An endpoint that moves onto its daemon id keeps the project it had open (`rekeyEndpoint`). */
export const rekeyLastProject = (oldId: string, newId: string, storage: LastProjectStorage | null = browserStorage()): void => {
    const last = readLastProject(storage);
    if (last?.endpointId !== oldId) {
        return;
    }
    write(storage, { endpointId: newId, projectId: last.projectId });
};
