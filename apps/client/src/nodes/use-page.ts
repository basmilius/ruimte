import { useEffect } from 'react';
import { browserRegistry, useBrowserRow } from '@/browser/registry';
import { isDesktop } from '@/desktop/bridge';
import { useNodeHost } from '@/nodes/node-host';
import { endpointKey, useEndpointId } from '@/state/keys';

/*
 * Keeps one page alive for this client. The view's address starts it; navigation stays in the
 * client runtime. The page itself is a <webview> in the parking layer, never here. A node without
 * an address has no page at all: it shows the splash until something gives it one.
 */
export const usePage = (id: string): { url: string; available: boolean } => {
    const host = useNodeHost(id);
    const savedUrl = host?.url ?? '';
    const state = useBrowserRow(id, (row) => row);
    const key = endpointKey(useEndpointId(), id);
    const available = isDesktop();

    useEffect(() => {
        if (available && savedUrl !== '') {
            browserRegistry.ensure(key, savedUrl);
        }
        // The page stays when this unmounts (culling, a view switch); only a delete destroys it.
    }, [key, available, savedUrl]);

    return { url: state?.url ?? savedUrl, available };
};
