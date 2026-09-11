import { create } from 'zustand';
import type { Reachability } from '@ruimte/contracts';

const STORAGE_KEY = 'ruimte.endpoints';
// Version 1 keyed a row on its address; version 2 keys it on the id the daemon answers with.
const STORAGE_VERSION = 2;
export const LOCAL_ENDPOINT_ID = 'local';

export interface Endpoint {
    /* The daemon's own id from `endpoint.info`, or `local` for the daemon that served this page. */
    id: string;
    label: string;
    /* Where this daemon last answered; a hint, not an identity. */
    httpBaseUrl: string;
    wsBaseUrl: string;
    reachability: Reachability;
    /* The long-lived session token from pairing; the loopback daemon needs none. */
    token: string | null;
    /*
     * The daemon that last answered on this address. `local` learns it too, which is how the client
     * tells that a paired row and the page's own daemon are the same machine.
     */
    daemonId: string | null;
}

interface EndpointsStore {
    endpoints: Endpoint[];
    activeId: string;
    /* Rows whose address answered as another daemon, and the id it answered with; a warning, never a change. */
    mismatched: Record<string, string>;
    add(endpoint: Endpoint): void;
    remove(id: string): void;
    setActive(id: string): void;
    setLabel(id: string, label: string): void;
    learnDaemonId(id: string, daemonId: string): void;
    /* Moves a row onto the id its daemon answers with; the pre-phase-1 rows were keyed on an address. */
    rekeyEndpoint(oldId: string, newId: string): void;
    noteMismatch(id: string, daemonId: string): void;
}

/* The daemon this page was served by, or in dev the Vite origin that proxies to it. */
const localEndpoint = (): Endpoint => {
    const origin = typeof location === 'undefined' ? 'http://127.0.0.1:4210' : location.origin;
    return {
        id: LOCAL_ENDPOINT_ID,
        label: 'This machine',
        httpBaseUrl: origin,
        wsBaseUrl: origin.replace(/^http/, 'ws'),
        reachability: 'loopback',
        token: null,
        daemonId: null
    };
};

/*
 * The remembered rows, without the local one, which is rebuilt from this page's own origin. A blob
 * from before endpoints had a daemon id keeps its host-shaped ids: which machine such a row is only
 * becomes known when it answers again, and `rekeyEndpoint` moves it then.
 */
export const parseStoredEndpoints = (raw: string | null): { endpoints: Endpoint[]; activeId: string | null; migrated: boolean } => {
    if (raw === null) {
        return { endpoints: [], activeId: null, migrated: false };
    }
    try {
        const stored = JSON.parse(raw) as { version?: number; endpoints?: Endpoint[]; activeId?: string };
        const endpoints = (stored.endpoints ?? [])
            .filter((endpoint) => endpoint?.id !== undefined && endpoint.id !== LOCAL_ENDPOINT_ID)
            .map((endpoint) => ({ ...endpoint, daemonId: endpoint.daemonId ?? null }));
        return { endpoints, activeId: stored.activeId ?? null, migrated: stored.version !== STORAGE_VERSION };
    } catch {
        return { endpoints: [], activeId: null, migrated: false };
    }
};

const persist = (state: { endpoints: Endpoint[]; activeId: string }): void => {
    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                version: STORAGE_VERSION,
                endpoints: state.endpoints.filter((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID),
                activeId: state.activeId
            })
        );
    } catch {
        // Storage that refuses keeps the endpoints for this session only.
    }
};

const read = (): { endpoints: Endpoint[]; activeId: string } => {
    const local = localEndpoint();
    let raw: string | null = null;
    try {
        raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    } catch {
        // Storage that refuses leaves this client with the daemon that served it.
    }
    const stored = parseStoredEndpoints(raw);
    const endpoints = [local, ...stored.endpoints];
    const activeId = endpoints.some((endpoint) => endpoint.id === stored.activeId) ? stored.activeId! : LOCAL_ENDPOINT_ID;
    if (stored.migrated) {
        persist({ endpoints, activeId });
    }
    return { endpoints, activeId };
};

/* Every daemon this client knows and which one it talks to; the loopback one is always there. */
export const useEndpoints = create<EndpointsStore>((set, get) => ({
    ...read(),
    mismatched: {},
    add(endpoint) {
        const endpoints = [...get().endpoints.filter((entry) => entry.id !== endpoint.id), endpoint];
        set({ endpoints });
        persist({ endpoints, activeId: get().activeId });
    },
    remove(id) {
        if (id === LOCAL_ENDPOINT_ID) {
            return;
        }
        const endpoints = get().endpoints.filter((entry) => entry.id !== id);
        const activeId = get().activeId === id ? LOCAL_ENDPOINT_ID : get().activeId;
        const { [id]: _gone, ...mismatched } = get().mismatched;
        set({ endpoints, activeId, mismatched });
        persist({ endpoints, activeId });
    },
    setActive(id) {
        if (!get().endpoints.some((entry) => entry.id === id)) {
            return;
        }
        set({ activeId: id });
        persist({ endpoints: get().endpoints, activeId: id });
    },
    setLabel(id, label) {
        const endpoints = get().endpoints.map((entry) => (entry.id === id ? { ...entry, label } : entry));
        set({ endpoints });
        persist({ endpoints, activeId: get().activeId });
    },
    learnDaemonId(id, daemonId) {
        const endpoints = get().endpoints.map((entry) => (entry.id === id ? { ...entry, daemonId } : entry));
        set({ endpoints });
        persist({ endpoints, activeId: get().activeId });
    },
    rekeyEndpoint(oldId, newId) {
        if (oldId === newId || oldId === LOCAL_ENDPOINT_ID || !get().endpoints.some((entry) => entry.id === oldId)) {
            return;
        }
        // The row that just answered carries the address and the token that work, so it wins from an older row under that id.
        const endpoints = get()
            .endpoints.filter((entry) => entry.id !== newId)
            .map((entry) => (entry.id === oldId ? { ...entry, id: newId, daemonId: newId } : entry));
        const activeId = get().activeId === oldId ? newId : get().activeId;
        const { [oldId]: _gone, ...mismatched } = get().mismatched;
        set({ endpoints, activeId, mismatched });
        persist({ endpoints, activeId });
    },
    noteMismatch(id, daemonId) {
        set({ mismatched: { ...get().mismatched, [id]: daemonId } });
    }
}));

export const activeEndpoint = (): Endpoint => {
    const { endpoints, activeId } = useEndpoints.getState();
    return endpoints.find((entry) => entry.id === activeId) ?? endpoints[0]!;
};

/* The socket address for an endpoint; the token rides in the query, which a browser cannot put in a header. */
export const socketUrlFor = (endpoint: Endpoint): string => `${endpoint.wsBaseUrl}/ws${endpoint.token ? `?token=${encodeURIComponent(endpoint.token)}` : ''}`;

/* `http://host:port/pair#token`, as the daemon prints it. */
export const parsePairingUrl = (input: string): { httpBaseUrl: string; token: string } | null => {
    let url: URL;
    try {
        url = new URL(input.trim());
    } catch {
        return null;
    }
    const token = url.hash.replace(/^#/, '');
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.pathname !== '/pair' || !token) {
        return null;
    }
    return { httpBaseUrl: url.origin, token };
};
