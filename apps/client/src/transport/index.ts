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
