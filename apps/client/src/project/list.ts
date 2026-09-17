import { isRecentProject, type ProjectSummary } from '@ruimte/contracts';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { useProjectList, type ProjectRow } from '@/state/project-list';
import { pool, transportFor, type ConnectionState } from '@/transport';

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
    useProjectList.getState().setProjects(endpointId, summaries);
    writeCachedList(endpointId, summaries);
};

/* `project.list` on one endpoint over the link it already has, folded into the union. A machine without one lists nothing new. */
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
    const state = useProjectList.getState();
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

export interface ProjectMenuRow {
    endpointId: string;
    /* What the machine this project sits on is called; a flat list puts it behind the name. */
    machineLabel: string;
    /* False when this client has no open socket to that machine: the row is what it last answered. */
    connected: boolean;
    summary: ProjectSummary;
}

export interface ProjectMenuRows {
    /* The projects in use, most recently opened first. */
    open: ProjectMenuRow[];
    /* The ones a person closed, most recently closed first. */
    recent: ProjectMenuRow[];
}

/* The rows of the union this client can still open, each with its machine's name. A row of a machine this client no longer knows has nothing to open it on. */
const knownRows = (rows: ProjectRow[], endpoints: Endpoint[], connected: readonly string[]): ProjectMenuRow[] => {
    const known = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
    return rows.flatMap((row) => {
        const endpoint = known.get(row.endpointId);
        if (!endpoint) {
            return [];
        }
        return [{ endpointId: row.endpointId, machineLabel: endpoint.label, connected: connected.includes(row.endpointId), summary: row.summary }];
    });
};

// Flatten machines into one list, sorting active projects by last open and recent ones by close time.
export const menuProjects = (rows: ProjectRow[], endpoints: Endpoint[], connected: readonly string[]): ProjectMenuRows => {
    const listed = knownRows(rows, endpoints, connected);
    return {
        open: listed.filter((row) => !isRecentProject(row.summary)).sort((a, b) => b.summary.lastOpenedAt - a.summary.lastOpenedAt),
        recent: listed.filter((row) => isRecentProject(row.summary)).sort((a, b) => (b.summary.closedAt ?? 0) - (a.summary.closedAt ?? 0))
    };
};

/* When a project was last touched: opened, or closed after that. */
const touchedAt = (summary: ProjectSummary): number => Math.max(summary.lastOpenedAt, summary.closedAt ?? 0);

/*
 * The start screen's one list: open and closed projects together, newest touch first, so the project
 * that was just closed sits on top and a wrong click is one click back.
 */
export const recentProjects = (rows: ProjectRow[], endpoints: Endpoint[], connected: readonly string[]): ProjectMenuRow[] =>
    knownRows(rows, endpoints, connected).sort((a, b) => touchedAt(b.summary) - touchedAt(a.summary));

/* What the list reads of the pool, so a test can hand it one of its own. */
export interface OpenListSource {
    ids(): string[];
    statusOf(endpointId: string): ConnectionState;
    subscribe(handler: () => void): () => void;
}

/*
 * Asks again whenever the set of open links changes. It only reads the pool: a machine without a link
 * keeps the list it last answered, and is asked the moment its link opens for any other reason.
 */
export const watchOpenLists = (source: OpenListSource, refresh: () => void): (() => void) => {
    const openOf = (): string =>
        source
            .ids()
            .filter((endpointId) => source.statusOf(endpointId).status === 'open')
            .join(',');
    let open = openOf();
    refresh();
    return source.subscribe(() => {
        const next = openOf();
        if (next === open) {
            return;
        }
        open = next;
        refresh();
    });
};

/*
 * Keeps the union in step with the machines that are up: a link that opens answers with its list,
 * one that closes leaves the rows it last gave behind, dimmed. Nothing here opens a link.
 */
export const startProjectList = (): (() => void) => {
    primeCachedLists();
    return watchOpenLists(pool, () => void refreshAllLists());
};
