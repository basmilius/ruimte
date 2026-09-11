import { rekeyLastProject } from '@/project/project-client';
import { activeEndpoint, LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { useToasts } from '@/state/toasts';

/*
 * What the daemon behind the active endpoint just said it is. A row keyed on an address (every row
 * written before endpoints had a daemon id) moves onto that id here. A row that already knows a
 * different daemon keeps everything it has: the address now points at another machine and the token
 * is for the old one, which is something to report rather than to adopt.
 */
export const noteDaemonIdentity = (daemonId: string): void => {
    const endpoint = activeEndpoint();
    if (endpoint.daemonId === daemonId) {
        return;
    }
    // The local row keeps its reserved id: the page's own origin is a daemon only in production, and a Vite server in dev.
    if (endpoint.id === LOCAL_ENDPOINT_ID || endpoint.id === daemonId) {
        useEndpoints.getState().learnDaemonId(endpoint.id, daemonId);
        return;
    }
    if (endpoint.daemonId === null) {
        rekeyLastProject(endpoint.id, daemonId);
        useEndpoints.getState().rekeyEndpoint(endpoint.id, daemonId);
        return;
    }
    useEndpoints.getState().noteMismatch(endpoint.id, daemonId);
    useToasts.getState().show({
        id: `endpoint-identity-${endpoint.id}`,
        kind: 'error',
        title: `${endpoint.label} answers as another machine`,
        description: `${endpoint.httpBaseUrl} is a different daemon than the one this client paired with. Pair again to talk to it.`
    });
};
