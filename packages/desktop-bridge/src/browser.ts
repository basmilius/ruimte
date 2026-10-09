export interface BrowserRouteBinding {
    webContentsId: number;
    endpointId: string;
    owner?: string;
    localMachineId?: string;
}

export interface BrowserRouteBlocked {
    webContentsId: number;
    url: string;
}
