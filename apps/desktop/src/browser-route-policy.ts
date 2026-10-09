import { isLoopbackBrowserUrl } from '@ruimte/contracts';
import type { BrowserRouteBinding } from '@ruimte/desktop-bridge';

export function parseBrowserRoute(value: unknown): BrowserRouteBinding | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const route = value as BrowserRouteBinding;
    const identity = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 1024;
    if (
        !Number.isSafeInteger(route.webContentsId) ||
        route.webContentsId <= 0 ||
        !identity(route.endpointId) ||
        (route.owner !== undefined && !identity(route.owner)) ||
        (route.localMachineId !== undefined && !identity(route.localMachineId))
    ) {
        return null;
    }
    if (route.owner !== undefined && (route.endpointId !== 'local' || route.owner !== route.localMachineId)) {
        return null;
    }
    return { webContentsId: route.webContentsId, endpointId: route.endpointId, owner: route.owner, localMachineId: route.localMachineId };
}

export function browserDestinationAllowed(route: BrowserRouteBinding | undefined, url: string): boolean {
    // The blank document is the only load allowed before the app binds the attached guest.
    return url === 'about:blank' || (route !== undefined && (route.endpointId === 'local' || !isLoopbackBrowserUrl(url)));
}
