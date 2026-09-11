import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useEndpoints } from '@/state/endpoints';
import { pool, transport, type ConnectionState, type Transport, type TransportStatus } from '@/transport';

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
 * The socket of one machine, opened and kept from going idle for as long as this is on screen. Null
 * for a machine this client does not know. A page that is about a machine it is not working on has to
 * hold its own socket; nothing else does, and the pool closes what nobody holds.
 */
export const useHeldTransport = (endpointId: string): Transport | null => {
    const endpoint = useEndpoints((s) => s.endpoints.find((entry) => entry.id === endpointId) ?? null);
    const link = useSyncExternalStore(
        useCallback((onChange: () => void) => pool.subscribeStatus(endpointId, onChange), [endpointId]),
        useCallback(() => pool.peek(endpointId), [endpointId])
    );
    useEffect(() => (endpoint === null ? undefined : pool.hold(endpoint)), [endpoint]);
    return link;
};

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

/* The machines that are answering right now, for a list that spans them. */
export const useOpenEndpoints = (): string[] => useSyncExternalStore(subscribePool, readOpenIds);
