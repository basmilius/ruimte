import { create } from 'zustand';
import type { Reachability } from '@ruimte/contracts';

const STORAGE_KEY = 'ruimte.endpoints';
export const LOCAL_ENDPOINT_ID = 'local';

export interface Endpoint {
    id: string;
    label: string;
    httpBaseUrl: string;
    wsBaseUrl: string;
    reachability: Reachability;
    /* The long-lived session token from pairing; the loopback daemon needs none. */
    token: string | null;
}

interface EndpointsStore {
    endpoints: Endpoint[];
    activeId: string;
    add(endpoint: Endpoint): void;
    remove(id: string): void;
    setActive(id: string): void;
    setLabel(id: string, label: string): void;
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
        token: null
    };
};

const read = (): { endpoints: Endpoint[]; activeId: string } => {
    const local = localEndpoint();
    try {
        const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
        const stored = raw ? (JSON.parse(raw) as { endpoints?: Endpoint[]; activeId?: string }) : {};
        const remote = (stored.endpoints ?? []).filter((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID);
        const endpoints = [local, ...remote];
        const activeId = endpoints.some((endpoint) => endpoint.id === stored.activeId) ? stored.activeId! : LOCAL_ENDPOINT_ID;
        return { endpoints, activeId };
    } catch {
        return { endpoints: [local], activeId: LOCAL_ENDPOINT_ID };
    }
};

const persist = (state: { endpoints: Endpoint[]; activeId: string }): void => {
    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ endpoints: state.endpoints.filter((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID), activeId: state.activeId })
        );
    } catch {
        // Storage that refuses keeps the endpoints for this session only.
    }
};

/* Every daemon this client knows and which one it talks to; the loopback one is always there. */
export const useEndpoints = create<EndpointsStore>((set, get) => ({
    ...read(),
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
        set({ endpoints, activeId });
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
