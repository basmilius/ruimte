import i18next from 'i18next';
import { create } from 'zustand';
import type { LanDoor, Reachability } from '@ruimte/contracts';
import { credentialFor } from '@/endpoint/credentials';
import { desktop } from '@/desktop/bridge';

export const ENDPOINTS_STORAGE_KEY = 'ruimte.endpoints';
/* Version 1 keyed a row on its address; version 2 keys it on the id the daemon answers with; version 3 pins its key;
   version 4 holds only rows reached through the account, since a machine takes nobody else in. */
const STORAGE_VERSION = 4;
export const LOCAL_ENDPOINT_ID = 'local';
/* What the row for this machine says when nothing better is known about it. */
export const localEndpointLabel = (): string => i18next.t('state:localMachine');

/*
 * The same row once the daemon has said what it runs on: "This MacBook Pro", "This Raspberry Pi 4
 * Model B". A name someone typed wins over both, and a machine that keeps its model to itself
 * (a container, a board without SMBIOS, a platform nothing here can read) keeps the plain label.
 */
export const localMachineLabel = (model: string | null): string =>
    model === null || model.trim() === '' ? localEndpointLabel() : i18next.t('state:localMachineWithModel', { model: model.trim() });

export interface Endpoint {
    /* The daemon's own id from `endpoint.info`, or `local` for the daemon that served this page. */
    id: string;
    label: string;
    /* Where this daemon last answered; a hint, not an identity. */
    httpBaseUrl: string;
    wsBaseUrl: string;
    reachability: Reachability;
    /*
     * The daemon that last answered on this address. `local` learns it too, which is how the client
     * tells that a row of the account and the page's own daemon are the same machine.
     */
    daemonId: string | null;
    /*
     * The daemon's ed25519 public key, from the account list that vouched for it. A daemon has to sign
     * a challenge with it, so the id above is a proof rather than a string read off the wire. Null for
     * the row of this machine, which proves itself with the local secret instead.
     */
    daemonPublicKey: string | null;
    /*
     * Whether this client reaches the machine over a WebRTC DataChannel instead of the socket. Every
     * other machine is reached that way; for the row of this machine it is a choice, off when absent.
     */
    direct?: boolean;
    /*
     * The broker the machine announces itself to, as the account list and `endpoint.info` last said.
     * Absent on a row from before the broker.
     */
    brokerUrl?: string | null;
    /*
     * The machine's door on the local network as `endpoint.info` last said, tried before the broker.
     * Null while the door is closed, absent on a row that never heard of it.
     */
    lan?: LanDoor | null;
    /*
     * How this client got in. A row from before accounts said `link` or nothing; those rows are dropped
     * when the list loads, since a machine takes nobody in that way any more.
     */
    pairedBy?: 'link' | 'statement';
    /*
     * Whether the next offer to this machine carries a statement. True for a row opened from the
     * account list, until the machine has let this client in once; from then on it knows the key.
     */
    needsStatement?: boolean;
}

interface EndpointsStore {
    endpoints: Endpoint[];
    activeId: string;
    /* Rows whose address answered as another daemon, and the id it answered with; a warning, never a change. */
    mismatched: Record<string, string>;
    /* A machine opened from the account. One daemon is one row, so a machine already listed keeps its place. */
    add(endpoint: Endpoint): void;
    remove(id: string): void;
    setActive(id: string): void;
    /*
     * Reads the rows another window wrote. The active one stays this window's own, and follows its
     * row onto the daemon's id when the other window moved it there.
     */
    reload(): void;
    setLabel(id: string, label: string): void;
    learnDaemonId(id: string, daemonId: string): void;
    /* Moves a row onto the id its daemon answers with, over a row already under that id; the pre-phase-1 rows were keyed on an address. */
    rekeyEndpoint(oldId: string, newId: string): void;
    noteMismatch(id: string, daemonId: string): void;
    setDirect(id: string, direct: boolean): void;
    learnBrokerUrl(id: string, brokerUrl: string | null): void;
    learnLan(id: string, lan: LanDoor | null): void;
    /* The machine let this client in on a statement, so the next attempt needs none. */
    settleStatement(id: string): void;
    /* The machine no longer knows this client's key, so the next attempt carries a statement again. */
    requireStatement(id: string): void;
}

/* The machine the desktop app started, or the page's own origin: the daemon or, in dev, the Vite origin that proxies to it. */
const localEndpoint = (): Endpoint => {
    const origin = desktop()?.daemonUrl ?? (typeof location === 'undefined' ? 'http://127.0.0.1:4210' : location.origin);
    return {
        id: LOCAL_ENDPOINT_ID,
        label: localEndpointLabel(),
        httpBaseUrl: origin,
        wsBaseUrl: origin.replace(/^http/, 'ws'),
        reachability: 'loopback',
        daemonId: null,
        daemonPublicKey: null
    };
};

/*
 * The remembered rows, without the local one, which is rebuilt from this page's own origin. A row
 * from a pairing link is dropped: the machine lets nobody in that way any more, and the account list
 * opens a machine on the account again under the same id. What is left is reached directly.
 */
export const parseStoredEndpoints = (raw: string | null): { endpoints: Endpoint[]; activeId: string | null; migrated: boolean } => {
    if (raw === null) {
        return { endpoints: [], activeId: null, migrated: false };
    }
    try {
        const stored = JSON.parse(raw) as { version?: number; endpoints?: Array<Endpoint & { token?: unknown }>; activeId?: string };
        const endpoints = (stored.endpoints ?? [])
            .filter((endpoint) => endpoint?.id !== undefined && endpoint.id !== LOCAL_ENDPOINT_ID && endpoint.pairedBy === 'statement')
            .map(({ token: _token, ...endpoint }) => ({
                ...endpoint,
                daemonId: endpoint.daemonId ?? null,
                daemonPublicKey: endpoint.daemonPublicKey ?? null,
                direct: true
            }));
        return { endpoints, activeId: stored.activeId ?? null, migrated: stored.version !== STORAGE_VERSION };
    } catch {
        return { endpoints: [], activeId: null, migrated: false };
    }
};

/* The local row is rebuilt from the page's origin on every start, so the one choice a person makes about it is kept beside the list. */
export const storedLocalDirect = (raw: string | null): boolean => {
    try {
        return raw !== null && (JSON.parse(raw) as { localDirect?: unknown }).localDirect === true;
    } catch {
        return false;
    }
};

const persist = (state: { endpoints: Endpoint[]; activeId: string }): void => {
    try {
        localStorage.setItem(
            ENDPOINTS_STORAGE_KEY,
            JSON.stringify({
                version: STORAGE_VERSION,
                endpoints: state.endpoints.filter((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID),
                activeId: state.activeId,
                localDirect: state.endpoints.some((endpoint) => endpoint.id === LOCAL_ENDPOINT_ID && endpoint.direct === true)
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
        raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(ENDPOINTS_STORAGE_KEY);
    } catch {
        // Storage that refuses leaves this client with the daemon that served it.
    }
    const stored = parseStoredEndpoints(raw);
    const endpoints = [storedLocalDirect(raw) ? { ...local, direct: true } : local, ...stored.endpoints];
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
        // The row keeps its place in the list; the key it pinned survives a row that brings none.
        const row = known
            ? { ...endpoint, daemonPublicKey: endpoint.daemonPublicKey ?? known.daemonPublicKey, ...(known.direct === true ? { direct: true } : {}) }
            : endpoint;
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
    reload() {
        const stored = read();
        const before = get();
        // The page's own row knows what it learned this session, and only the Direct switch is kept in storage.
        const ownLocal = before.endpoints.find((endpoint) => endpoint.id === LOCAL_ENDPOINT_ID);
        const endpoints = stored.endpoints.map((endpoint) => {
            if (endpoint.id !== LOCAL_ENDPOINT_ID || !ownLocal) {
                return endpoint;
            }
            const { direct: _direct, ...local } = ownLocal;
            return endpoint.direct === true ? { ...local, direct: true } : local;
        });
        const known = (id: string | null | undefined): id is string => typeof id === 'string' && endpoints.some((endpoint) => endpoint.id === id);
        const movedTo = before.endpoints.find((endpoint) => endpoint.id === before.activeId)?.daemonId;
        const activeId = known(before.activeId) ? before.activeId : known(movedTo) ? movedTo : LOCAL_ENDPOINT_ID;
        const mismatched = Object.fromEntries(Object.entries(before.mismatched).filter(([id]) => known(id)));
        set({ endpoints, activeId, mismatched });
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
        // The row that just answered carries the address that works, so it wins from an older row under that id.
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
    },
    setDirect(id, direct) {
        const endpoints = get().endpoints.map((entry) => (entry.id === id ? { ...entry, direct } : entry));
        set({ endpoints });
        persist({ endpoints, activeId: get().activeId });
    },
    learnBrokerUrl(id, brokerUrl) {
        // Asked on every connection, and nearly always the same answer; a write per connection would buy nothing.
        if (!get().endpoints.some((entry) => entry.id === id && (entry.brokerUrl ?? null) !== brokerUrl)) {
            return;
        }
        const endpoints = get().endpoints.map((entry) => (entry.id === id ? { ...entry, brokerUrl } : entry));
        set({ endpoints });
        persist({ endpoints, activeId: get().activeId });
    },
    learnLan(id, lan) {
        // Asked on every connection like the broker, and written only when the door moved.
        if (!get().endpoints.some((entry) => entry.id === id && JSON.stringify(entry.lan ?? null) !== JSON.stringify(lan))) {
            return;
        }
        const endpoints = get().endpoints.map((entry) => (entry.id === id ? { ...entry, lan } : entry));
        set({ endpoints });
        persist({ endpoints, activeId: get().activeId });
    },
    settleStatement(id) {
        if (!get().endpoints.some((entry) => entry.id === id && entry.needsStatement === true)) {
            return;
        }
        const endpoints = get().endpoints.map((entry) => (entry.id === id ? { ...entry, needsStatement: false } : entry));
        set({ endpoints });
        persist({ endpoints, activeId: get().activeId });
    },
    requireStatement(id) {
        if (id === LOCAL_ENDPOINT_ID || !get().endpoints.some((entry) => entry.id === id && entry.needsStatement !== true)) {
            return;
        }
        const endpoints = get().endpoints.map((entry) => (entry.id === id ? { ...entry, needsStatement: true } : entry));
        set({ endpoints });
        persist({ endpoints, activeId: get().activeId });
    }
}));

/*
 * The broker route of a row: Direct on, a broker the machine announced, and a machine key pinned to
 * believe its signals by. The row of this machine never takes it, since it has no pinned key and its
 * own address is always there.
 */
export const brokerRouteOf = (endpoint: Endpoint): { brokerUrl: string; machineKey: string } | null => {
    if (endpoint.direct !== true || endpoint.id === LOCAL_ENDPOINT_ID || !endpoint.brokerUrl || endpoint.daemonPublicKey === null) {
        return null;
    }
    return { brokerUrl: endpoint.brokerUrl, machineKey: endpoint.daemonPublicKey };
};

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
export const socketUrlFor = (endpoint: Pick<Endpoint, 'id' | 'wsBaseUrl'>): string => {
    const credential = credentialFor(endpoint);
    return `${endpoint.wsBaseUrl}/ws${credential ? `?token=${encodeURIComponent(credential)}` : ''}`;
};
