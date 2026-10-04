import { clientKey, type ClientKey } from '@/endpoint/client-key';
import { rememberTicket } from '@/endpoint/credentials';
import { verifySignature } from '@ruimte/pulsar/verify-web';
import { socketAddressFor } from '@/endpoint/handshake';
import { machineAccess } from '@/pulsar/statements';
import { hasLocalMachine } from '@/state/local-machine';
import { LOCAL_ENDPOINT_ID, brokerRouteOf, endpointById, useEndpoints, type Endpoint } from '@/state/endpoints';
import { iceServersFrom, useSettings } from '@/state/settings';
import { IS_STATION } from '@/station';
import { ActiveTransport } from './active-transport';
import { brokerSignaling } from './broker-signaling';
import { directProof } from './direct-auth';
import { DormantTransport } from './dormant-transport';
import { lanSignaling } from './lan-signaling';
import { LinkTransport, type LinkOpener } from './link-transport';
import { MachineTransports } from './machine-transport';
import { TransportPool } from './pool';
import { lanDoorUrls, lanSkips, routedLink } from './route-race';
import type { SignalingOpener } from './signaling';
import type { Transport } from './transport';
import { webRtcLink, type WebRtcLinkOptions } from './webrtc-link';
import { socketLink } from './websocket-transport';

export type { ConnectionState, SignalRoute, Transport, TransportStatus } from './transport';
export { TransportError } from './transport';

/* What a direct connection to a row needs whatever carries its signals. */
const directOptions = (endpointId: () => string): Omit<WebRtcLinkOptions, 'signaling'> => ({
    iceServers: iceServersFrom(useSettings.getState().directStunServers),
    prove: (challenge, binding) => directProof(endpointId(), challenge, binding),
    accepted: (ticket) => {
        if (ticket !== null) {
            rememberTicket(endpointId(), ticket);
        }
        useEndpoints.getState().settleStatement(endpointId());
    },
    // The next attempt carries a statement again, which is how a client comes back once the machine forgot it.
    unknownKey: () => useEndpoints.getState().requireStatement(endpointId())
});

/*
 * How the signals to a machine of the account may travel: its doors on the local network, which the
 * row learned from `endpoint.info`, and the broker it announces itself to.
 */
const routesOf = (endpoint: Endpoint): { lan: SignalingOpener[]; broker: SignalingOpener | null } => {
    const machineKey = endpoint.daemonPublicKey;
    if (machineKey === null) {
        return { lan: [], broker: null };
    }
    // A machine opened from the account list does not know this key until an offer carries a statement it takes.
    const access = endpoint.needsStatement === true ? { access: (key: ClientKey) => machineAccess(endpoint.id, key) } : {};
    const route = brokerRouteOf(endpoint);
    return {
        lan: lanDoorUrls(endpoint.lan, IS_STATION).map((url) =>
            lanSignaling({ url, machineKey, machineId: endpoint.daemonId, key: clientKey, verify: verifySignature, ...access })
        ),
        broker: route ? brokerSignaling({ brokerUrl: route.brokerUrl, machineKey, key: clientKey, verify: verifySignature, ...access }) : null
    };
};

/*
 * Which link a machine's next connection opens. The row of this machine opens a WebSocket on its own
 * address, or a DataChannel signaled over that socket when Direct is on. Every other machine is
 * reached over a DataChannel whose signals race between its doors on the local network and the
 * broker. Decided per attempt rather than per transport, so a change of route reconnects the
 * transport every session and chat client is already built on instead of replacing it.
 */
const linkFor =
    (endpointId: () => string): LinkOpener =>
    (url, events) => {
        const endpoint = endpointById(endpointId());
        if (!endpoint || (endpoint.id === LOCAL_ENDPOINT_ID && endpoint.direct !== true)) {
            return socketLink(url, events);
        }
        const options = directOptions(endpointId);
        if (endpoint.id === LOCAL_ENDPOINT_ID) {
            return webRtcLink(options)(url, events);
        }
        const { lan, broker } = routesOf(endpoint);
        return routedLink({
            machineId: endpoint.daemonId ?? endpoint.id,
            lan,
            broker,
            skips: lanSkips,
            link: (signaling) => webRtcLink({ ...options, signaling: () => signaling })
        })(url, events);
    };

/*
 * Where a machine's next connection opens. The row of this machine opens on its own address, with a
 * ticket signed for over HTTP. Every other machine is reached through a route, which asks nothing of
 * an address that from another network is not there to ask, so the broker URL only names the attempt.
 */
export const connectionAddressFor = (endpointId: string): Promise<string> =>
    endpointId === LOCAL_ENDPOINT_ID ? socketAddressFor(endpointId) : Promise.resolve(endpointById(endpointId)?.brokerUrl ?? '');

/*
 * One connection per daemon, each with its own reconnect loop; nothing here opens one until it is
 * held. The address is worked out per attempt, because every connection signs for its own ticket.
 * On the web client the row of this machine opens nothing, since no daemon answers on the page's own origin.
 */
export const pool = new TransportPool({
    open: (endpoint: Endpoint, currentId: () => string) =>
        !hasLocalMachine() && endpoint.id === LOCAL_ENDPOINT_ID
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
 * The link of one machine by id if this client has one, and null otherwise. It never opens one. A
 * link opens only for a hold (a workspace with a project, a dialog about the machine) or through
 * `ensureMachine`, so a call site that means to reach a machine takes one of those first.
 */
export const transportFor = (endpointId: string): Transport | null => pool.peek(endpointId);

const machineTransports = new MachineTransports(pool);

/* One machine as a transport that outlives its link; see `MachineTransports`. */
export const machineTransport = (endpointId: string): Transport => machineTransports.of(endpointId);

/* Before `pool.rekey`, so the clients on the transport of a row that learned its daemon id keep their link. */
export const rekeyMachineTransport = (oldId: string, newId: string): void => machineTransports.rekey(oldId, newId);
