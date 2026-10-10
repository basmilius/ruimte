import i18next from 'i18next';
import type { EndpointInfo } from '@ruimte/contracts';
import { forgetEndpoint } from '@/endpoint';
import { rekeyClientLocal } from '@/project/client-local';
import { browserStorage, rekeyLastProject } from '@/project/last-project';
import { LOCAL_ENDPOINT_ID, endpointById, endpointForDaemon, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useToasts } from '@/state/toasts';
import { connectionAddressFor, pool, rekeyMachineTransport } from '@/transport';
import { rekeyTicket } from './credentials';

/*
 * What the daemon behind an endpoint just said it is, and the id that row ends up on. A row keyed on
 * an address (every row written before endpoints had a daemon id) moves onto that id here. A row
 * that already knows a different daemon keeps everything it has, because the address now points at
 * another machine; that mismatch is reported rather than adopted.
 */
export function noteDaemonIdentity(endpointId: string, info: EndpointInfo): string {
    const daemonId = info.id;
    const endpoint = endpointById(endpointId);
    if (!endpoint) {
        return endpointId;
    }
    /*
     * One row per daemon, or two rows fill with the same sessions under two keys. Only a row free to
     * take this id looks for a twin; a row that answers as another daemon is the mismatch below.
     */
    const twin = endpoint.daemonId === null || endpoint.daemonId === daemonId ? endpointForDaemon(daemonId, endpoint.id) : null;
    if (twin?.id === LOCAL_ENDPOINT_ID) {
        // The address this row was keyed on is this machine's own, and the local row reaches it with the local secret.
        void dropDuplicate(twin, endpoint);
        return twin.id;
    }
    // The local row keeps its reserved id. The page's own origin is a daemon only in production, and a Vite server in dev.
    if (endpoint.id === LOCAL_ENDPOINT_ID || endpoint.id === daemonId) {
        if (endpoint.daemonId !== daemonId) {
            useEndpoints.getState().learnDaemonId(endpoint.id, daemonId);
        }
        if (twin) {
            // A row of the account that answered before this one said who it is turns out to be this machine.
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
        // The socket moves with the row, since it is the one that just answered; closing it would drop what is attached to it.
        rekeyMachineTransport(endpoint.id, daemonId);
        pool.rekey(endpoint.id, daemonId, () => connectionAddressFor(daemonId));
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
        title: i18next.t('machines:identity.mismatch.title', { label: endpoint.label }),
        description: i18next.t('machines:identity.mismatch.description', { address: endpoint.httpBaseUrl })
    });
    return endpoint.id;
}

/* The row that goes, with everything this client kept under its key; a row being worked on sends the app home first. */
async function dropDuplicate(kept: Endpoint, dropped: Endpoint): Promise<void> {
    await forgetEndpoint(dropped.id);
    reportOneMachine(kept, dropped);
}

/* A row that disappears without a word reads as a machine that was forgotten, so say which two turned out to be one. */
function reportOneMachine(kept: Endpoint, dropped: Endpoint): void {
    useToasts.getState().show({
        id: `endpoint-merged-${dropped.id}`,
        kind: 'success',
        title: i18next.t('machines:identity.merged.title', { label: dropped.label }),
        description: i18next.t('machines:identity.merged.description', { address: dropped.httpBaseUrl, machine: kept.label })
    });
}
