import { browserRegistry, normalizeUrl } from '@/browser/registry';
import { isDesktop } from '@/desktop/bridge';
import { readNodeHost, updateHost } from '@/nodes/node-host';
import { endpointKey } from '@/state/keys';
import { browserClientFor } from '@/transport/connections';

/*
 * Where a browser node goes next. A node without an address is given one, which is what starts its
 * page at all: the splash and the address bar both come through here, so a node that begins empty
 * ends up the same as one that was made with an address.
 */
export const openPage = (id: string, endpointId: string, input: string): void => {
    const url = normalizeUrl(input);
    if (!readNodeHost(id)?.url) {
        updateHost(id, { url });
        return;
    }
    if (isDesktop()) {
        browserRegistry.navigate(endpointKey(endpointId, id), url);
    } else {
        browserClientFor(endpointId)?.navigate(id, url);
    }
};
