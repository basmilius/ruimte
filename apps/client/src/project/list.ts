import type { ProjectSummary } from '@ruimte/contracts';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { useProject, type ProjectRow } from '@/state/project';
import { pool, transportFor } from '@/transport';

const CACHE_PREFIX = 'ruimte.projects.';
/* Enough to hold every project a machine is likely to have; a list this long is scrolled, not read. */
const CACHE_LIMIT = 50;

type ListStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const browserStorage = (): ListStorage | null => (typeof localStorage === 'undefined' ? null : localStorage);

/*
 * The last answer of a machine, so a laptop that is asleep still lists what is on it. The rows are
 * shown as not connected until that machine answers again, which is the moment they are replaced.
 */
export const readCachedList = (endpointId: string, storage: ListStorage | null = browserStorage()): ProjectSummary[] => {
    const raw = storage?.getItem(`${CACHE_PREFIX}${endpointId}`) ?? null;
    if (raw === null) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed) ? (parsed as ProjectSummary[]) : [];
    } catch {
        return [];
    }
};

export const writeCachedList = (endpointId: string, summaries: ProjectSummary[], storage: ListStorage | null = browserStorage()): void => {
    // The ones that were opened most recently are the ones worth remembering when the list is long.
    const kept = [...summaries].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, CACHE_LIMIT);
    try {
        storage?.setItem(`${CACHE_PREFIX}${endpointId}`, JSON.stringify(kept));
    } catch {
        // Storage that refuses leaves this machine without a remembered list, which only costs a dimmed row.
    }
};

export const forgetCachedList = (endpointId: string, storage: ListStorage | null = browserStorage()): void => {
    storage?.removeItem(`${CACHE_PREFIX}${endpointId}`);
};

/* One machine's answer into the union, and into the list it is remembered by. */
export const foldList = (endpointId: string, summaries: ProjectSummary[]): void => {
    useProject.getState().setProjects(endpointId, summaries);
    writeCachedList(endpointId, summaries);
};

/* `project.list` on one endpoint, folded into the union. */
export const listProjects = async (endpointId: string): Promise<ProjectRow[]> => {
    const transport = transportFor(endpointId);
    if (!transport) {
        return [];
    }
    const { projects } = await transport.request('project.list', {});
    foldList(endpointId, projects);
    return projects.map((summary) => ({ endpointId, summary }));
};

/* Re-asks every machine whose socket is up and folds the answers in. A machine that is not there keeps its remembered list. */
export const refreshAllLists = async (): Promise<void> => {
    const open = openEndpointIds();
    await Promise.all(open.map((endpointId) => listProjects(endpointId).catch(() => [])));
};

/* Fills the union from what each machine last answered, for the frame before any of them does. */
export const primeCachedLists = (storage: ListStorage | null = browserStorage()): void => {
    const state = useProject.getState();
    for (const endpoint of useEndpoints.getState().endpoints) {
        if (state.projects.some((row) => row.endpointId === endpoint.id)) {
            continue;
        }
        const cached = readCachedList(endpoint.id, storage);
        if (cached.length > 0) {
            state.setProjects(endpoint.id, cached);
        }
    }
};

const openEndpointIds = (): string[] => pool.ids().filter((endpointId) => pool.statusOf(endpointId).status === 'open');

export interface ProjectGroup {
    endpointId: string;
    label: string;
    /* False when this client has no open socket to that machine: its rows are what it last answered. */
    connected: boolean;
    rows: ProjectRow[];
}

/*
 * The union as the menu draws it: the machine being worked on first, the rest in the order the
 * endpoint list has them. A machine without projects is left out, so one daemon reads as it always did.
 */
export const groupProjects = (rows: ProjectRow[], endpoints: Endpoint[], activeId: string, connected: readonly string[]): ProjectGroup[] => {
    const ordered = [...endpoints].sort((a, b) => Number(b.id === activeId) - Number(a.id === activeId));
    return ordered
        .map((endpoint) => ({
            endpointId: endpoint.id,
            label: endpoint.label,
            connected: connected.includes(endpoint.id),
            rows: rows.filter((row) => row.endpointId === endpoint.id)
        }))
        .filter((group) => group.rows.length > 0);
};

/*
 * Keeps the union in step with the machines that are up: a socket that opens answers with its list,
 * one that closes leaves the rows it last gave behind, dimmed.
 */
export const startProjectList = (): (() => void) => {
    primeCachedLists();
    let open = openEndpointIds().join(',');
    void refreshAllLists();
    return pool.subscribe(() => {
        const next = openEndpointIds().join(',');
        if (next === open) {
            return;
        }
        open = next;
        void refreshAllLists();
    });
};
