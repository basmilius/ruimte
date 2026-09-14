// A plain require: the bundler's ESM interop copies enumerable keys, and electron's are getters.
const { contextBridge, ipcRenderer, webUtils } = require('electron') as typeof import('electron');

/* What the client may ask the shell for. The shape is mirrored in `apps/client/src/desktop/bridge.ts`. */
contextBridge.exposeInMainWorld('ruimteDesktop', {
    platform: process.platform,
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    pickFolder: (initialPath?: string): Promise<string | null> => ipcRenderer.invoke('dialog:pick-folder', initialPath),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),
    /* Only this side can say where a dragged file came from: `File.path` was taken out of Electron
       and the renderer has no `webUtils`. Empty for anything that is not a file on disk. */
    pathForFile: (file: File): string | null => webUtils.getPathForFile(file) || null,
    openGuestDevTools: (webContentsId: number): void => ipcRenderer.send('devtools:guest', webContentsId),
    onBrowserContextMenu: (listener: (params: unknown) => void): (() => void) => {
        const handler = (_event: unknown, params: unknown): void => listener(params);
        ipcRenderer.on('browser:context-menu', handler);
        return () => ipcRenderer.removeListener('browser:context-menu', handler);
    },
    browserContextAction: (action: unknown): void => ipcRenderer.send('browser:context-action', action),
    onGuestFocus: (listener: (webContentsId: number) => void): (() => void) => {
        const handler = (_event: unknown, webContentsId: number): void => listener(webContentsId);
        ipcRenderer.on('guest:focus', handler);
        return () => ipcRenderer.removeListener('guest:focus', handler);
    },
    onOpenSettings: (listener: (section: string | null) => void): (() => void) => {
        const handler = (_event: unknown, section: string | null): void => listener(section);
        ipcRenderer.on('menu:settings', handler);
        return () => ipcRenderer.removeListener('menu:settings', handler);
    },
    isFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:is-fullscreen'),
    onFullscreen: (listener: (fullscreen: boolean) => void): (() => void) => {
        const handler = (_event: unknown, fullscreen: boolean): void => listener(fullscreen);
        ipcRenderer.on('window:fullscreen', handler);
        return () => ipcRenderer.removeListener('window:fullscreen', handler);
    },
    setTheme: (theme: { resolved: 'light' | 'dark'; followsSystem: boolean; background: string }): void => ipcRenderer.send('window:theme', theme),
    setKeepAwake: (keep: boolean): void => ipcRenderer.send('power:keep-awake', keep),
    setAgentActivity: (activity: { working: number; attention: number }): void => ipcRenderer.send('agents:activity', activity),
    saveFile: (suggestedName: string, bytes: Uint8Array, mime: string): Promise<string | null> =>
        ipcRenderer.invoke('dialog:save-file', suggestedName, bytes, mime),
    updateState: (): Promise<unknown> => ipcRenderer.invoke('update:state'),
    onUpdateState: (listener: (state: unknown) => void): (() => void) => {
        const handler = (_event: unknown, state: unknown): void => listener(state);
        ipcRenderer.on('update:state', handler);
        return () => ipcRenderer.removeListener('update:state', handler);
    },
    configureUpdates: (autoDownload: boolean): Promise<void> => ipcRenderer.invoke('update:configure', autoDownload),
    checkForUpdate: (): Promise<void> => ipcRenderer.invoke('update:check'),
    downloadUpdate: (): Promise<void> => ipcRenderer.invoke('update:download'),
    installUpdate: (): void => ipcRenderer.send('update:install'),
    releaseNotes: (refresh?: boolean): Promise<unknown> => ipcRenderer.invoke('releases:list', refresh === true),
    localSecret: (): Promise<string | null> => ipcRenderer.invoke('daemon:local-secret'),
    pulsar: {
        addressBook: (): Promise<string> => ipcRenderer.invoke('pulsar:address-book'),
        listen: (): Promise<{ redirectUri: string }> => ipcRenderer.invoke('pulsar:login-listen'),
        callback: (): Promise<unknown> => ipcRenderer.invoke('pulsar:login-callback'),
        cancel: (): Promise<void> => ipcRenderer.invoke('pulsar:login-cancel'),
        exchange: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('pulsar:exchange', payload),
        refresh: (): Promise<unknown> => ipcRenderer.invoke('pulsar:refresh'),
        restore: (): Promise<unknown> => ipcRenderer.invoke('pulsar:restore'),
        signOut: (): Promise<void> => ipcRenderer.invoke('pulsar:sign-out')
    }
});
