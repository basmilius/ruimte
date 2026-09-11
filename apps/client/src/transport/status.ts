import { useCallback, useSyncExternalStore } from 'react';
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

/* The machines this client holds a socket for, in the order the pool opened them. */
export const useConnectedEndpoints = (): string[] => useSyncExternalStore(subscribePool, readPoolIds);
