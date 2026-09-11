import { socketUrlFor, useEndpoints, type Endpoint } from '@/state/endpoints';
import { ActiveTransport } from './active-transport';
import { TransportPool } from './pool';
import type { Transport } from './transport';
import { WebSocketTransport } from './websocket-transport';

export type { ConnectionState, Transport, TransportStatus } from './transport';
export { TransportError } from './transport';

/* One socket per daemon, each with its own reconnect loop; nothing here opens one until it is asked for. */
export const pool = new TransportPool({ open: (endpoint: Endpoint) => new WebSocketTransport(socketUrlFor(endpoint)) });

/* The machine the person is working on, as one transport. Everything cwd-shaped and node-shaped talks through it. */
export const transport: Transport = new ActiveTransport({
    source: pool,
    activeId: () => useEndpoints.getState().activeId,
    subscribeActive: (handler) =>
        useEndpoints.subscribe((state, before) => {
            if (state.activeId !== before.activeId) {
                handler();
            }
        })
});

/*
 * The socket of one machine by id, opened if this client has none for it yet. Null for a machine
 * this client does not know, which is what a row that was forgotten leaves behind.
 */
export const transportFor = (endpointId: string): Transport | null => {
    const endpoint = useEndpoints.getState().endpoints.find((entry) => entry.id === endpointId);
    return endpoint ? pool.require(endpoint) : null;
};
