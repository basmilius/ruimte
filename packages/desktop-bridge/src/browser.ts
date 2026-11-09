export interface BrowserRouteBinding {
    webContentsId: number;
    endpointId: string;
    owner?: string;
    localMachineId?: string;
}

export interface BrowserRouteBlocked {
    webContentsId: number;
    url: string;
    /* Set for a page of a shared port: requests of the page itself that were refused, `count` since the last message, with `url` the latest. */
    subresource?: boolean;
    count?: number;
}
