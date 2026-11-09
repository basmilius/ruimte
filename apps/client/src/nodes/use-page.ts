import { useEffect } from 'react';
import { localBrowserRouteAvailable } from '@/clients/browser/owner-route';
import { browserRegistry } from '@/clients/browser/registry';
import { isDesktop } from '@/desktop/bridge';
import { usePortGrants, usePortGrantWatch } from '@/port-tunnel/grants';
import { usePortTunnelPartitions } from '@/port-tunnel/tunnel-pages';
import { useEndpointId } from '@/state/current-endpoint';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { endpointKey } from '@/state/keys';
import { useNodeHost } from '@/surface/nodes/node-host';

/* The local machine's daemon id, which decides whether a page's route is open; a caller may only need the redraw. */
export function useLocalDaemonId(): string | null | undefined {
    return useEndpoints((store) => store.endpoints.find((endpoint) => endpoint.id === LOCAL_ENDPOINT_ID)?.daemonId);
}

/*
 * Keeps one page alive for this client, started at the node's saved address. The page itself is a
 * <webview> in the parking layer. A node without an address has no page and shows the splash until
 * something gives it one.
 */
export function usePage(id: string): void {
    const host = useNodeHost(id);
    const savedUrl = host?.url ?? '';
    const owner = host?.browserOwner;
    const endpointId = useEndpointId();
    const key = endpointKey(endpointId, id);
    const localDaemonId = useLocalDaemonId();
    // A port shared on another machine opens once its tunnel is ready, and ends with the grant, so both redraw the node.
    const grants = usePortGrants((store) => store.byEndpoint[endpointId]);
    const tunnelPartition = usePortTunnelPartitions((store) => store.byKey[key]);
    const available = isDesktop() && localBrowserRouteAvailable(endpointId, savedUrl, owner, localDaemonId);

    usePortGrantWatch(endpointId);

    useEffect(() => {
        if (isDesktop() && savedUrl !== '') {
            browserRegistry.ensure(key, savedUrl, owner);
        } else if (!available) {
            browserRegistry.suspend(key);
        }
        // The page stays when this unmounts (culling, a view switch); only a delete destroys it.
    }, [key, available, savedUrl, owner, grants, tunnelPartition]);
}
