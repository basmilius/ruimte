import type { EndpointInfo } from '@ruimte/contracts';
import { forgetEndpoint } from '@/endpoint';
import { rekeyClientLocal } from '@/project/client-local';
import { browserStorage, rekeyLastProject } from '@/project/last-project';
import { LOCAL_ENDPOINT_ID, endpointById, endpointForDaemon, useEndpoints, type Endpoint } from '@/state/endpoints';
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
    const endpoint = endpointById(endpointId);
    if (!endpoint) {
        return endpointId;
    }
    /*
     * One row per daemon. Two rows for one machine would fill with the same sessions, chats and
     * projects under two keys, and forgetting one of them would look like forgetting the machine.
     * Only a row that is free to take this id looks for a twin: a paired row that answers as another
     * daemon is the mismatch below, and adopting anything there is what pinning exists to prevent.
     */
    const twin = endpoint.daemonId === null || endpoint.daemonId === daemonId ? endpointForDaemon(daemonId, endpoint.id) : null;
    if (twin?.id === LOCAL_ENDPOINT_ID) {
        // The address this row was keyed on is this machine's own, and the local row reaches it without a credential.
        void dropDuplicate(twin, endpoint);
        return twin.id;
    }
    // The local row keeps its reserved id: the page's own origin is a daemon only in production, and a Vite server in dev.
    if (endpoint.id === LOCAL_ENDPOINT_ID || endpoint.id === daemonId) {
        if (endpoint.daemonId !== daemonId) {
            useEndpoints.getState().learnDaemonId(endpoint.id, daemonId);
        }
        if (twin) {
            // A machine paired over its LAN address before this row said who it is turns out to be this one.
            void dropDuplicate(endpoint, twin);
        }
        return endpoint.id;
    }
    if (endpoint.daemonId === daemonId) {
        return endpoint.id;
    }
    if (endpoint.daemonId === null) {
        rekeyLastProject(endpoint.id, daemonId);
        rekeyClientLocal(browserStorage(), endpoint.id, daemonId);
        // The socket moves with the row: it is the one that just answered, and closing it would drop what is attached to it.
        pool.rekey(endpoint.id, daemonId, () => socketAddressFor(daemonId));
        rekeyTicket(endpoint.id, daemonId);
        // The row that just answered keeps the address and the credential that work; `rekeyEndpoint` drops the row that held the id.
        useEndpoints.getState().rekeyEndpoint(endpoint.id, daemonId);
        if (twin) {
            reportOneMachine(endpoint, twin);
        }
        return daemonId;
    }
    useEndpoints.getState().noteMismatch(endpoint.id, daemonId);
    useToasts.getState().show({
        id: `endpoint-identity-${endpoint.id}`,
        kind: 'error',
        title: `${endpoint.label} answers as another machine`,
        description: `${endpoint.httpBaseUrl} is not the machine this client paired with. Pair again to connect.`
    });
    return endpoint.id;
};

/* The row that goes, with everything this client kept under its key; a row being worked on sends the app home first. */
const dropDuplicate = async (kept: Endpoint, dropped: Endpoint): Promise<void> => {
    await forgetEndpoint(dropped.id);
    reportOneMachine(kept, dropped);
};

/* A row that disappears without a word reads as a machine that was forgotten, so say which two turned out to be one. */
const reportOneMachine = (kept: Endpoint, dropped: Endpoint): void => {
    useToasts.getState().show({
        id: `endpoint-merged-${dropped.id}`,
        kind: 'success',
        title: `${dropped.label} is already in the list`,
        description: `${dropped.httpBaseUrl} is another address of ${kept.label}.`
    });
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
