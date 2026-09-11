import type { EndpointInfo } from '@ruimte/contracts';
import { rekeyLastProject } from '@/project/last-project';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { useToasts } from '@/state/toasts';
import { pool, transportFor } from '@/transport';
import { clientKey } from './client-key';
import { rekeyTicket } from './credentials';
import { socketAddressFor } from './handshake';

/*
 * What the daemon behind an endpoint just said it is, and the id that row ends up on. A row keyed on
 * an address (every row written before endpoints had a daemon id) moves onto that id here. A row
 * that already knows a different daemon keeps everything it has: the address now points at another
 * machine and the token is for the old one, which is something to report rather than to adopt.
 */
export const noteDaemonIdentity = (endpointId: string, info: EndpointInfo): string => {
    const settled = settleId(endpointId, info.id);
    void adoptKey(settled, info);
    return settled;
};

const settleId = (endpointId: string, daemonId: string): string => {
    const endpoint = useEndpoints.getState().endpoints.find((entry) => entry.id === endpointId);
    if (!endpoint || endpoint.daemonId === daemonId) {
        return endpointId;
    }
    // The local row keeps its reserved id: the page's own origin is a daemon only in production, and a Vite server in dev.
    if (endpoint.id === LOCAL_ENDPOINT_ID || endpoint.id === daemonId) {
        useEndpoints.getState().learnDaemonId(endpoint.id, daemonId);
        return endpoint.id;
    }
    if (endpoint.daemonId === null) {
        rekeyLastProject(endpoint.id, daemonId);
        // The socket moves with the row: it is the one that just answered, and closing it would drop what is attached to it.
        pool.rekey(endpoint.id, daemonId, () => socketAddressFor(daemonId));
        rekeyTicket(endpoint.id, daemonId);
        useEndpoints.getState().rekeyEndpoint(endpoint.id, daemonId);
        return daemonId;
    }
    useEndpoints.getState().noteMismatch(endpoint.id, daemonId);
    useToasts.getState().show({
        id: `endpoint-identity-${endpoint.id}`,
        kind: 'error',
        title: `${endpoint.label} answers as another machine`,
        description: `${endpoint.httpBaseUrl} is a different daemon than the one this client paired with. Pair again to talk to it.`
    });
    return endpoint.id;
};

/*
 * The way a client that paired before there were key pairs moves onto one, without anybody pairing
 * again. It runs over a connection the session token already authenticated, which is the only
 * moment this client can believe a key it did not get at pairing: the daemon's key is pinned and
 * this client's is registered, and from the next connection on both sides sign instead. The token
 * that used to sit in every URL is dropped by the daemon the first time a signature lands, and by
 * this client the first time a ticket comes back.
 */
const adoptKey = async (endpointId: string, info: EndpointInfo): Promise<void> => {
    const endpoint = useEndpoints.getState().endpoints.find((entry) => entry.id === endpointId);
    if (!endpoint || !info.publicKey || endpoint.token === null) {
        return;
    }
    const key = await clientKey();
    if (!key) {
        return;
    }
    const link = transportFor(endpointId);
    if (!link) {
        return;
    }
    try {
        const { registered } = await link.request('auth.registerKey', { publicKey: key.publicKey });
        if (registered) {
            useEndpoints.getState().pinDaemonKey(endpointId, info.publicKey);
        }
    } catch {
        // A daemon that does not know the request is one without key pairs; the token keeps working.
    }
};
