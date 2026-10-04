import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { Endpoint } from '@/state/endpoints';
import { useLastSeen } from '@/state/last-seen';
import { pool, transport, type ConnectionState, type TransportStatus } from '@/transport';

function subscribe(onChange: () => void): () => void {
    return transport.subscribeStatus(onChange);
}
function read(): TransportStatus {
    return transport.status;
}

// A transport without a reconnect loop still needs one object per status, or the snapshot
// would be a new object on every render and React would never stop re-rendering.
const PLAIN: Record<TransportStatus, ConnectionState> = {
    open: { status: 'open', attempts: 0, retryAt: null },
    connecting: { status: 'connecting', attempts: 0, retryAt: null },
    closed: { status: 'closed', attempts: 0, retryAt: null }
};

function readConnection(): ConnectionState {
    return transport.connection ?? PLAIN[transport.status];
}

function subscribePool(onChange: () => void): () => void {
    return pool.subscribe(onChange);
}
function readPoolIds(): string[] {
    return pool.ids();
}

export function useTransportStatus(): TransportStatus {
    return useSyncExternalStore(subscribe, read);
}

export function useConnection(): ConnectionState {
    return useSyncExternalStore(subscribe, readConnection);
}

/* The socket of one machine, for a list that shows a dot per row. */
export function useEndpointConnection(endpointId: string): ConnectionState {
    return useSyncExternalStore(
        useCallback((onChange: () => void) => pool.subscribeStatus(endpointId, onChange), [endpointId]),
        useCallback(() => pool.statusOf(endpointId), [endpointId])
    );
}

/*
 * Keeps one machine's link up for as long as this is on screen, opening it when there is none. Only
 * for a surface that is an explicit look at that machine (its detail in settings): a list, a dot or a page about
 * every machine never holds, or opening settings would connect to all of them.
 */
export function useMachineHold(endpoint: Endpoint | null): void {
    useEffect(() => (endpoint === null ? undefined : pool.hold(endpoint)), [endpoint]);
}

/* When a machine last had an open link on this client, or null when it never had one. */
export function useLastSeenAt(endpointId: string): number | null {
    return useLastSeen((s) => s.byEndpoint[endpointId] ?? null);
}

/* The machines this client holds a socket for, in the order the pool opened them. */
export function useConnectedEndpoints(): string[] {
    return useSyncExternalStore(subscribePool, readPoolIds);
}

// The same array until the set itself changes, or every render would hand React a new snapshot.
let openIds: string[] = [];

function readOpenIds(): string[] {
    const next = pool.ids().filter((endpointId) => pool.statusOf(endpointId).status === 'open');
    if (next.length !== openIds.length || next.some((id, i) => id !== openIds[i])) {
        openIds = next;
    }
    return openIds;
}

// The same object until a machine's state changes or the set does, for the same reason.
let connections: Record<string, ConnectionState> = {};

function readConnections(): Record<string, ConnectionState> {
    const ids = pool.ids();
    const same = ids.length === Object.keys(connections).length && ids.every((endpointId) => connections[endpointId] === pool.statusOf(endpointId));
    if (!same) {
        connections = Object.fromEntries(ids.map((endpointId) => [endpointId, pool.statusOf(endpointId)]));
    }
    return connections;
}

/* The state of every link the pool has, with the failure behind a closed one; a machine without a link is absent. */
export function useConnections(): Record<string, ConnectionState> {
    return useSyncExternalStore(subscribePool, readConnections);
}

/* The machines that are answering right now, for a list that spans them. */
export function useOpenEndpoints(): string[] {
    return useSyncExternalStore(subscribePool, readOpenIds);
}
