import { ProjectLocalSchema, type ProjectLocal, type ProjectViewLocal } from '@ruimte/contracts';
import { endpointKey, isOfEndpoint } from '@/state/keys';

const CLIENT_LOCAL_KEY = 'ruimte.local';

/* Every project this client ever looked at would otherwise stay, and the panels of a big repository are not small. */
export const CLIENT_LOCAL_LIMIT = 100;

export type ClientLocalStorage = Pick<Storage, 'getItem' | 'setItem'>;

interface ClientLocalRow {
    at: number;
    local: ProjectLocal;
}

type ClientLocalRows = Record<string, ClientLocalRow>;

const readRows = (storage: ClientLocalStorage | null): ClientLocalRows => {
    const raw = storage?.getItem(CLIENT_LOCAL_KEY) ?? null;
    if (raw === null) {
        return {};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }
    if (typeof parsed !== 'object' || parsed === null) {
        return {};
    }
    const rows: ClientLocalRows = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        const row = value as Partial<ClientLocalRow> | null;
        const local = ProjectLocalSchema.safeParse(row?.local);
        if (typeof row?.at === 'number' && local.success) {
            rows[key] = { at: row.at, local: local.data };
        }
    }
    return rows;
};

const isQuotaError = (e: unknown): boolean => (e as { name?: unknown } | null)?.name === 'QuotaExceededError';

const oldestKey = (rows: ClientLocalRows, except: string | null): string | null => {
    let oldest: string | null = null;
    for (const [key, row] of Object.entries(rows)) {
        if (key !== except && (oldest === null || row.at < rows[oldest]!.at)) {
            oldest = key;
        }
    }
    return oldest;
};

/*
 * A full storage drops the oldest project and tries once more. What this client remembers is a
 * convenience on top of what the machine keeps, so after that it gives up without a word.
 */
const writeRows = (storage: ClientLocalStorage | null, rows: ClientLocalRows, keep: string | null = null): void => {
    if (storage === null) {
        return;
    }
    try {
        storage.setItem(CLIENT_LOCAL_KEY, JSON.stringify(rows));
    } catch (e) {
        const oldest = isQuotaError(e) ? oldestKey(rows, keep) : null;
        if (oldest === null) {
            return;
        }
        delete rows[oldest];
        try {
            storage.setItem(CLIENT_LOCAL_KEY, JSON.stringify(rows));
        } catch {
            // Given up: the machine still has it.
        }
    }
};

/* Page identity follows this browser client; it must never become the starting point of another one. */
export const withoutClientBrowserState = (local: ProjectLocal): ProjectLocal => {
    if (!local.panels?.favicons) {
        return local;
    }
    const { favicons: _favicons, ...panels } = local.panels;
    return { ...local, panels };
};

/* What this client last had of one project on one machine, or null when it never saw it. */
export const readClientLocal = (storage: ClientLocalStorage | null, endpointId: string, projectId: string): ProjectLocal | null =>
    readRows(storage)[endpointKey(endpointId, projectId)]?.local ?? null;

export const writeClientLocal = (storage: ClientLocalStorage | null, endpointId: string, projectId: string, local: ProjectLocal, now = Date.now()): void => {
    const rows = readRows(storage);
    const key = endpointKey(endpointId, projectId);
    rows[key] = { at: now, local };
    while (Object.keys(rows).length > CLIENT_LOCAL_LIMIT) {
        delete rows[oldestKey(rows, key)!];
    }
    writeRows(storage, rows, key);
};

/* A deleted project leaves nothing behind to come back to. */
export const dropClientLocal = (storage: ClientLocalStorage | null, endpointId: string, projectId: string): void => {
    const rows = readRows(storage);
    const key = endpointKey(endpointId, projectId);
    if (rows[key] === undefined) {
        return;
    }
    delete rows[key];
    writeRows(storage, rows);
};

/* A forgotten machine takes its projects with it, like every other row about it. */
export const dropClientLocalOf = (storage: ClientLocalStorage | null, endpointId: string): void => {
    const rows = readRows(storage);
    const kept = Object.fromEntries(Object.entries(rows).filter(([key]) => !isOfEndpoint(key, endpointId)));
    if (Object.keys(kept).length !== Object.keys(rows).length) {
        writeRows(storage, kept);
    }
};

/* An endpoint that moves onto its daemon id keeps where it stood in every project (`rekeyEndpoint`). */
export const rekeyClientLocal = (storage: ClientLocalStorage | null, oldId: string, newId: string): void => {
    const rows = readRows(storage);
    let moved = false;
    const next: ClientLocalRows = {};
    for (const [key, row] of Object.entries(rows)) {
        if (isOfEndpoint(key, oldId)) {
            // Sliced rather than split: an id from before daemon ids was an address, colon and all.
            next[endpointKey(newId, key.slice(oldId.length + 1))] = row;
            moved = true;
        } else {
            next[key] = row;
        }
    }
    if (moved) {
        writeRows(storage, next);
    }
};

/*
 * What this client has wins, and what it never saw comes from the machine. A record for the project
 * brings the grid, the panels and the open view along, even a grid that is one cell; a view is
 * looked up on its own, because one made on another screen has no camera here. A favicon follows
 * the client that loaded the page; an old machine-local favicon is discarded during migration.
 */
export const overlayLocal = (machine: ProjectLocal, client: ProjectLocal | null): ProjectLocal => {
    if (client === null) {
        return withoutClientBrowserState(machine);
    }
    const views: Record<string, ProjectViewLocal> = { ...machine.views };
    for (const [viewId, view] of Object.entries(client.views)) {
        if (view.camera !== null || machine.views[viewId] === undefined) {
            views[viewId] = view;
        }
    }
    return {
        activeViewId: client.activeViewId,
        views,
        ...(client.panels ? { panels: client.panels } : {}),
        ...(client.layout ? { layout: client.layout } : {})
    };
};
