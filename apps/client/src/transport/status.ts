import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { Endpoint } from '@/state/endpoints';
import { useLastSeen } from '@/state/last-seen';
import { pool, transport, type ConnectionState, type TransportStatus } from '@/transport';

const subscribe = (onChange: () => void): (() => void) => transport.subscribeStatus(onChange);
const read = (): TransportStatus => transport.status;

// A transport without a reconnect loop still needs one object per status, or the snapshot
// would be a new object on every render and React would never stop re-rendering.
const PLAIN: Record<TransportStatus, ConnectionState> = {
    open: { status: 'open', attempts: 0, retryAt: null },
    connecting: { status: 'connecting', attempts: 0, retryAt: null },
    closed: { status: 'closed', attempts: 0, retryAt: null }
};

const readConnection = (): ConnectionState => transport.connection ?? PLAIN[transport.status];

const subscribePool = (onChange: () => void): (() => void) => pool.subscribe(onChange);
const readPoolIds = (): string[] => pool.ids();

export const useTransportStatus = (): TransportStatus => useSyncExternalStore(subscribe, read);

export const useConnection = (): ConnectionState => useSyncExternalStore(subscribe, readConnection);

/* The socket of one machine, for a list that shows a dot per row. */
export const useEndpointConnection = (endpointId: string): ConnectionState =>
    useSyncExternalStore(
        useCallback((onChange: () => void) => pool.subscribeStatus(endpointId, onChange), [endpointId]),
        useCallback(() => pool.statusOf(endpointId), [endpointId])
    );

/*
 * Keeps one machine's link up for as long as this is on screen, opening it when there is none. Only
 * for a surface that is an explicit look at that machine (its dialog): a list, a dot or a page about
 * every machine never holds, or opening settings would connect to all of them.
 */
export const useMachineHold = (endpoint: Endpoint | null): void => {
    useEffect(() => (endpoint === null ? undefined : pool.hold(endpoint)), [endpoint]);
};

/* When a machine last had an open link on this client, or null when it never had one. */
export const useLastSeenAt = (endpointId: string): number | null => useLastSeen((s) => s.byEndpoint[endpointId] ?? null);

/* The machines this client holds a socket for, in the order the pool opened them. */
export const useConnectedEndpoints = (): string[] => useSyncExternalStore(subscribePool, readPoolIds);

// The same array until the set itself changes, or every render would hand React a new snapshot.
let openIds: string[] = [];

const readOpenIds = (): string[] => {
    const next = pool.ids().filter((endpointId) => pool.statusOf(endpointId).status === 'open');
    if (next.length !== openIds.length || next.some((id, i) => id !== openIds[i])) {
        openIds = next;
    }
    return openIds;
};

// The same object until a machine's state changes or the set does, for the same reason.
let connections: Record<string, ConnectionState> = {};

const readConnections = (): Record<string, ConnectionState> => {
    const ids = pool.ids();
    const same = ids.length === Object.keys(connections).length && ids.every((endpointId) => connections[endpointId] === pool.statusOf(endpointId));
    if (!same) {
        connections = Object.fromEntries(ids.map((endpointId) => [endpointId, pool.statusOf(endpointId)]));
    }
    return connections;
};

/* The state of every link the pool has, with the failure behind a closed one; a machine without a link is absent. */
export const useConnections = (): Record<string, ConnectionState> => useSyncExternalStore(subscribePool, readConnections);

/* The machines that are answering right now, for a list that spans them. */
export const useOpenEndpoints = (): string[] => useSyncExternalStore(subscribePool, readOpenIds);
