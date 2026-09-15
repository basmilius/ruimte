import { clientKey, type ClientKey } from '@/endpoint/client-key';
import { rememberTicket } from '@/endpoint/credentials';
import { socketAddressFor, verifyDaemon } from '@/endpoint/handshake';
import { machineAccess } from '@/pulsar/statements';
import { IS_STATION } from '@/station';
import { LOCAL_ENDPOINT_ID, brokerRouteOf, endpointById, useEndpoints, type Endpoint } from '@/state/endpoints';
import { iceServersFrom, useSettings } from '@/state/settings';
import { ActiveTransport } from './active-transport';
import { brokerSignaling } from './broker-signaling';
import { directProof } from './direct-auth';
import { DormantTransport } from './dormant-transport';
import { LinkTransport, type LinkOpener } from './link-transport';
import { TransportPool } from './pool';
import type { Transport } from './transport';
import { webRtcLink } from './webrtc-link';
import { socketLink } from './websocket-transport';

export type { ConnectionState, Transport, TransportStatus } from './transport';
export { TransportError } from './transport';

/*
 * Which link a machine's next connection opens: a WebSocket, or a WebRTC DataChannel when its row
 * says so, signaled over the broker when the row has one and over a socket to the machine otherwise.
 * Decided per attempt rather than per transport, so switching a machine over reconnects the
 * transport every session and chat client is already built on instead of replacing it.
 */
const linkFor =
    (endpointId: () => string): LinkOpener =>
    (url, events) => {
        const endpoint = endpointById(endpointId());
        if (endpoint?.direct !== true) {
            return socketLink(url, events);
        }
        const route = brokerRouteOf(endpoint);
        // A machine opened from the account list does not know this key until an offer carries a statement it takes.
        const access = endpoint.needsStatement === true ? { access: (key: ClientKey) => machineAccess(endpoint.id, key) } : {};
        return webRtcLink({
            ...(route
                ? {
                      signaling: () =>
                          brokerSignaling({ brokerUrl: route.brokerUrl, machineKey: route.machineKey, key: clientKey, verify: verifyDaemon, ...access })
                  }
                : {}),
            iceServers: iceServersFrom(useSettings.getState().directStunServer),
            prove: (challenge, binding) => directProof(endpointId(), challenge, binding),
            accepted: (ticket) => {
                if (ticket !== null) {
                    rememberTicket(endpointId(), ticket);
                }
                useEndpoints.getState().settleStatement(endpointId());
            }
        })(url, events);
    };

/*
 * Where a machine's next connection opens. Over the broker that is the broker itself and nothing is
 * asked of the machine's own address, which from another network is not there to ask; otherwise it
 * is the socket URL with a ticket signed for over HTTP.
 */
export const connectionAddressFor = (endpointId: string): Promise<string> => {
    const endpoint = endpointById(endpointId);
    const route = endpoint ? brokerRouteOf(endpoint) : null;
    return route ? Promise.resolve(route.brokerUrl) : socketAddressFor(endpointId);
};

/*
 * One connection per daemon, each with its own reconnect loop; nothing here opens one until it is
 * asked for. The address is worked out per attempt, because every connection signs for its own ticket.
 * On the web client the row of this machine opens nothing: no daemon answers on the page's own origin.
 */
export const pool = new TransportPool({
    open: (endpoint: Endpoint, currentId: () => string) =>
        IS_STATION && endpoint.id === LOCAL_ENDPOINT_ID
            ? new DormantTransport()
            : new LinkTransport(() => connectionAddressFor(currentId()), linkFor(currentId))
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
