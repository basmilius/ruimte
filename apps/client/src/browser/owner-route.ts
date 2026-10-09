import { desktop, isDesktop } from '@/desktop/bridge';
import { endpointById, LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { terminalLinkTarget } from '@/terminal/links';

export function browserRouteAvailable(endpointId: string, url: string, owner?: string): boolean {
    return !isDesktop() && owner === undefined ? true : localBrowserRouteAvailable(endpointId, url, owner);
}

export function localBrowserRouteAvailable(endpointId: string, url: string, owner?: string): boolean {
    if (!isDesktop()) {
        return false;
    }
    const shell = desktop();
    if ((endpointId !== LOCAL_ENDPOINT_ID || owner !== undefined) && (!shell?.bindBrowserRoute || !shell.onBrowserRouteBlocked)) {
        return false;
    }
    if (owner !== undefined) {
        return endpointId === LOCAL_ENDPOINT_ID && endpointById(LOCAL_ENDPOINT_ID)?.daemonId === owner;
    }
    // Older saved nodes lack an owner. Their project machine still rules out client localhost.
    return terminalLinkTarget(url, endpointId, true) !== 'remote-loopback';
}
