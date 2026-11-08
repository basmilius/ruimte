import { desktop, isDesktop } from '@/desktop/bridge';
import { portTunnelPages } from '@/port-tunnel/tunnel-pages';
import { endpointById, LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { terminalLinkTarget } from '@/terminal/links';

/* A render passes `localDaemonId` from `useLocalDaemonId`, so its answer follows this machine's daemon id once it is known. */
export function browserRouteAvailable(endpointId: string, url: string, owner?: string, localDaemonId = currentLocalDaemonId()): boolean {
    return !isDesktop() && owner === undefined ? true : localBrowserRouteAvailable(endpointId, url, owner, localDaemonId);
}

export function localBrowserRouteAvailable(endpointId: string, url: string, owner?: string, localDaemonId = currentLocalDaemonId()): boolean {
    if (!isDesktop()) {
        return false;
    }
    if (sharedPortRouteAvailable(endpointId, url, owner)) {
        return true;
    }
    const shell = desktop();
    if ((endpointId !== LOCAL_ENDPOINT_ID || owner !== undefined) && (!shell?.bindBrowserRoute || !shell.onBrowserRouteBlocked)) {
        return false;
    }
    if (owner !== undefined) {
        return endpointId === LOCAL_ENDPOINT_ID && localDaemonId === owner;
    }
    // Older saved nodes lack an owner. Their project machine still rules out client localhost.
    return terminalLinkTarget(url, endpointId, true) !== 'remote-loopback';
}

/*
 * A loopback address on another machine opens only through a port that machine shares for this project, in a
 * session of its own. A node whose owner is another machine than the one its project is on has no route either way.
 */
function sharedPortRouteAvailable(endpointId: string, url: string, owner: string | undefined): boolean {
    if (owner !== undefined && endpointById(endpointId)?.daemonId !== owner) {
        return false;
    }

    return portTunnelPages.grantFor(endpointId, url) !== null;
}

function currentLocalDaemonId(): string | null | undefined {
    return endpointById(LOCAL_ENDPOINT_ID)?.daemonId;
}
