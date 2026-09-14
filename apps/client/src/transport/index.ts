import { rememberTicket } from '@/endpoint/credentials';
import { socketAddressFor } from '@/endpoint/handshake';
import { endpointById, useEndpoints, type Endpoint } from '@/state/endpoints';
import { iceServersFrom, useSettings } from '@/state/settings';
import { ActiveTransport } from './active-transport';
import { directProof } from './direct-auth';
import { LinkTransport, type LinkOpener } from './link-transport';
import { TransportPool } from './pool';
import type { Transport } from './transport';
import { webRtcLink } from './webrtc-link';
import { socketLink } from './websocket-transport';

export type { ConnectionState, Transport, TransportStatus } from './transport';
export { TransportError } from './transport';

/*
 * Which link a machine's next connection opens: a WebSocket, or a WebRTC DataChannel when its row
 * says so. Decided per attempt rather than per transport, so switching a machine over reconnects
 * the transport every session and chat client is already built on instead of replacing it.
 */
const linkFor =
    (endpointId: () => string): LinkOpener =>
    (url, events) => {
        if (endpointById(endpointId())?.direct !== true) {
            return socketLink(url, events);
        }
        return webRtcLink({
            iceServers: iceServersFrom(useSettings.getState().directStunServer),
            prove: (challenge, binding) => directProof(endpointId(), challenge, binding),
            accepted: (ticket) => {
                if (ticket !== null) {
                    rememberTicket(endpointId(), ticket);
                }
            }
        })(url, events);
    };

/*
 * One connection per daemon, each with its own reconnect loop; nothing here opens one until it is
 * asked for. The address is worked out per attempt, because every connection signs for its own ticket.
 */
export const pool = new TransportPool({
    open: (_endpoint: Endpoint, currentId: () => string) => new LinkTransport(() => socketAddressFor(currentId()), linkFor(currentId))
});

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
