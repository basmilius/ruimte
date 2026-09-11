import { create } from 'zustand';
import type { Reachability } from '@ruimte/contracts';
import { credentialFor } from '@/endpoint/credentials';

const STORAGE_KEY = 'ruimte.endpoints';
// Version 1 keyed a row on its address; version 2 keys it on the id the daemon answers with; version 3 pins its key.
const STORAGE_VERSION = 3;
export const LOCAL_ENDPOINT_ID = 'local';

export interface Endpoint {
    /* The daemon's own id from `endpoint.info`, or `local` for the daemon that served this page. */
    id: string;
    label: string;
    /* Where this daemon last answered; a hint, not an identity. */
    httpBaseUrl: string;
    wsBaseUrl: string;
    reachability: Reachability;
    /*
     * The session token from pairing, for a daemon or a browser that cannot do key pairs. Null once
     * this client has signed for a ticket instead, which is what every fresh pairing does.
     */
    token: string | null;
    /*
     * The daemon that last answered on this address. `local` learns it too, which is how the client
     * tells that a paired row and the page's own daemon are the same machine.
     */
    daemonId: string | null;
    /*
     * The daemon's ed25519 public key, pinned the first time this client saw it over a connection it
     * already trusted (pairing, or a token-authenticated socket). From then on a daemon has to sign
     * a challenge with it, so the id above is a proof rather than a string read off the wire.
     */
    daemonPublicKey: string | null;
}

interface EndpointsStore {
    endpoints: Endpoint[];
    activeId: string;
    /* Rows whose address answered as another daemon, and the id it answered with; a warning, never a change. */
    mismatched: Record<string, string>;
    /* A machine that just paired. One daemon is one row, so a pairing with a machine already listed moves that row. */
    add(endpoint: Endpoint): void;
    remove(id: string): void;
    setActive(id: string): void;
    setLabel(id: string, label: string): void;
    learnDaemonId(id: string, daemonId: string): void;
    /* Trust on first use: the key is written once and never overwritten, so a later answer cannot replace it. */
    pinDaemonKey(id: string, publicKey: string): void;
    /* The session token is not needed any more; this client signs for its credential now. */
    clearToken(id: string): void;
    /* Moves a row onto the id its daemon answers with, over a row already under that id; the pre-phase-1 rows were keyed on an address. */
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
        daemonId: null,
        daemonPublicKey: null
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
            .map((endpoint) => ({ ...endpoint, daemonId: endpoint.daemonId ?? null, daemonPublicKey: endpoint.daemonPublicKey ?? null }));
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
        const known = get().endpoints.find((entry) => entry.id === endpoint.id);
        /* The row keeps its place in the list and takes the address and the credential the pairing
           handed out. The key it pinned survives a pairing that brings none, which is what a client without ed25519 does. */
        const row = known ? { ...endpoint, daemonPublicKey: endpoint.daemonPublicKey ?? known.daemonPublicKey } : endpoint;
        const endpoints = known ? get().endpoints.map((entry) => (entry.id === row.id ? row : entry)) : [...get().endpoints, row];
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
    pinDaemonKey(id, publicKey) {
        const endpoints = get().endpoints.map((entry) =>
            entry.id === id && entry.daemonPublicKey === null ? { ...entry, daemonPublicKey: publicKey } : entry
        );
        set({ endpoints });
        persist({ endpoints, activeId: get().activeId });
    },
    clearToken(id) {
        const endpoints = get().endpoints.map((entry) => (entry.id === id ? { ...entry, token: null } : entry));
        set({ endpoints });
        persist({ endpoints, activeId: get().activeId });
    },
    rekeyEndpoint(oldId, newId) {
        if (oldId === newId || oldId === LOCAL_ENDPOINT_ID || !get().endpoints.some((entry) => entry.id === oldId)) {
            return;
        }
        // The row that just answered carries the address and the token that work, so it wins from an older row under that id.
        const replaced = get().endpoints.find((entry) => entry.id === newId);
        const endpoints = get()
            .endpoints.filter((entry) => entry.id !== newId)
            .map((entry) =>
                entry.id === oldId
                    ? // Trust on first use is about the daemon, not about the row, so the key the older row pinned outlives it.
                      { ...entry, id: newId, daemonId: newId, daemonPublicKey: entry.daemonPublicKey ?? replaced?.daemonPublicKey ?? null }
                    : entry
            );
        const activeId = get().activeId === oldId ? newId : get().activeId;
        const { [oldId]: _gone, ...mismatched } = get().mismatched;
        set({ endpoints, activeId, mismatched });
        persist({ endpoints, activeId });
    },
    noteMismatch(id, daemonId) {
        set({ mismatched: { ...get().mismatched, [id]: daemonId } });
    }
}));

/* One machine by id, for code that is about a row rather than about the machine being worked on. */
export const endpointById = (id: string): Endpoint | null => useEndpoints.getState().endpoints.find((entry) => entry.id === id) ?? null;

/*
 * The row this daemon is, whatever address it sits on. Only the local row holds a daemon id that is
 * not its own key, so a match is either the row keyed on that id or the machine this page came from.
 * `exceptId` leaves the row asking out of it, which is what makes it a duplicate check.
 */
export const endpointForDaemon = (daemonId: string, exceptId?: string): Endpoint | null =>
    useEndpoints.getState().endpoints.find((entry) => entry.id !== exceptId && (entry.id === daemonId || entry.daemonId === daemonId)) ?? null;

export const activeEndpoint = (): Endpoint => {
    const { endpoints, activeId } = useEndpoints.getState();
    return endpoints.find((entry) => entry.id === activeId) ?? endpoints[0]!;
};

/*
 * The socket address for an endpoint. The credential rides in the query because a browser cannot
 * put a header on a WebSocket handshake; what makes that bearable is that a ticket is what normally
 * sits there, good for one connection and for nothing on any other machine.
 */
export const socketUrlFor = (endpoint: Endpoint): string => {
    const credential = credentialFor(endpoint);
    return `${endpoint.wsBaseUrl}/ws${credential ? `?token=${encodeURIComponent(credential)}` : ''}`;
};

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
