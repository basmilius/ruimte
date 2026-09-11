const LAST_PROJECT_KEY = 'ruimte.lastProject';

export type LastProjectStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface LastProject {
    /* The last thing the person looked at, so a cold boot lands on that machine and that project. */
    last: { endpointId: string; projectId: string } | null;
    /* What was open per machine, so switching back reopens that machine's project. */
    byEndpoint: Record<string, string>;
}

const EMPTY: LastProject = { last: null, byEndpoint: {} };

export const browserStorage = (): LastProjectStorage | null => (typeof localStorage === 'undefined' ? null : localStorage);

/*
 * What was open per endpoint. A project id belongs to the daemon that minted it, so the project of
 * machine A is not in machine B's list and picking it up there would open whatever B lists first.
 * Two older shapes are read as well: a bare record from before there was a `last`, and the single
 * project id this key held before a client knew more than one daemon. `legacyEndpointId` is the
 * endpoint such a bare id belongs to.
 */
export const readLastProject = (storage: LastProjectStorage | null, legacyEndpointId: string | null): LastProject => {
    const raw = storage?.getItem(LAST_PROJECT_KEY) ?? null;
    if (raw === null) {
        return { ...EMPTY };
    }
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (typeof parsed === 'object' && parsed !== null) {
            const record = parsed as Partial<LastProject> & Record<string, unknown>;
            if (typeof record.byEndpoint === 'object' && record.byEndpoint !== null) {
                return { last: record.last ?? null, byEndpoint: { ...(record.byEndpoint as Record<string, string>) } };
            }
            return { last: null, byEndpoint: { ...(parsed as Record<string, string>) } };
        }
    } catch {
        // A bare project id, written before this key was a record.
    }
    return legacyEndpointId === null ? { ...EMPTY } : { last: { endpointId: legacyEndpointId, projectId: raw }, byEndpoint: { [legacyEndpointId]: raw } };
};

const write = (storage: LastProjectStorage | null, value: LastProject): void => {
    storage?.setItem(LAST_PROJECT_KEY, JSON.stringify(value));
};

/* What one machine has open now, and with it what the person looked at last. */
export const rememberProject = (endpointId: string, projectId: string | null, storage: LastProjectStorage | null = browserStorage()): void => {
    const stored = readLastProject(storage, endpointId);
    if (projectId === null) {
        delete stored.byEndpoint[endpointId];
        write(storage, { last: stored.last?.endpointId === endpointId ? null : stored.last, byEndpoint: stored.byEndpoint });
        return;
    }
    write(storage, { last: { endpointId, projectId }, byEndpoint: { ...stored.byEndpoint, [endpointId]: projectId } });
};

/* An endpoint that moves onto its daemon id keeps what it had open (`rekeyEndpoint`). */
export const rekeyLastProject = (oldId: string, newId: string, storage: LastProjectStorage | null = browserStorage()): void => {
    const stored = readLastProject(storage, oldId);
    const projectId = stored.byEndpoint[oldId];
    if (projectId === undefined) {
        return;
    }
    delete stored.byEndpoint[oldId];
    write(storage, {
        last: stored.last?.endpointId === oldId ? { endpointId: newId, projectId: stored.last.projectId } : stored.last,
        byEndpoint: { ...stored.byEndpoint, [newId]: projectId }
    });
};
