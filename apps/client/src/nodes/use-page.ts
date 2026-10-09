import { useEffect } from 'react';
import { browserRegistry, useBrowserRow } from '@/browser/registry';
import { isDesktop } from '@/desktop/bridge';
import { useNodeHost } from '@/nodes/node-host';
import { endpointKey, useEndpointId } from '@/state/keys';
import { localBrowserRouteAvailable } from '@/browser/owner-route';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';

/*
 * Keeps one page alive for this client, started at the node's saved address. The page itself is a
 * <webview> in the parking layer. A node without an address has no page and shows the splash until
 * something gives it one.
 */
export function usePage(id: string): { url: string; available: boolean } {
    const host = useNodeHost(id);
    const savedUrl = host?.url ?? '';
    const state = useBrowserRow(id, (row) => row);
    const endpointId = useEndpointId();
    const key = endpointKey(endpointId, id);
    const localIdentity = useEndpoints((store) => store.endpoints.find((endpoint) => endpoint.id === LOCAL_ENDPOINT_ID)?.daemonId);
    const available = isDesktop() && localBrowserRouteAvailable(endpointId, savedUrl, host?.browserOwner);

    useEffect(() => {
        if (isDesktop() && savedUrl !== '') {
            browserRegistry.ensure(key, savedUrl, host?.browserOwner);
        } else if (!available) {
            browserRegistry.suspend(key);
        }
        // The page stays when this unmounts (culling, a view switch); only a delete destroys it.
    }, [key, available, savedUrl, host?.browserOwner, localIdentity]);

    return { url: state?.url ?? savedUrl, available };
}
