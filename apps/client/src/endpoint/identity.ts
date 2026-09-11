import { rekeyLastProject } from '@/project/last-project';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { useToasts } from '@/state/toasts';
import { pool } from '@/transport';

/*
 * What the daemon behind an endpoint just said it is, and the id that row ends up on. A row keyed on
 * an address (every row written before endpoints had a daemon id) moves onto that id here. A row
 * that already knows a different daemon keeps everything it has: the address now points at another
 * machine and the token is for the old one, which is something to report rather than to adopt.
 */
export const noteDaemonIdentity = (endpointId: string, daemonId: string): string => {
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
        pool.rekey(endpoint.id, daemonId);
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
