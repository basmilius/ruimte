// A plain require: the bundler's ESM interop copies enumerable keys, and electron's are getters.
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

/* What the client may ask the shell for. The shape is mirrored in `apps/client/src/desktop/bridge.ts`. */
contextBridge.exposeInMainWorld('ruimteDesktop', {
    platform: process.platform,
    pickFolder: (initialPath?: string): Promise<string | null> => ipcRenderer.invoke('dialog:pick-folder', initialPath),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),
    openGuestDevTools: (webContentsId: number): void => ipcRenderer.send('devtools:guest', webContentsId),
    onBrowserContextMenu: (listener: (params: unknown) => void): (() => void) => {
        const handler = (_event: unknown, params: unknown): void => listener(params);
        ipcRenderer.on('browser:context-menu', handler);
        return () => ipcRenderer.removeListener('browser:context-menu', handler);
    },
    browserContextAction: (action: unknown): void => ipcRenderer.send('browser:context-action', action),
    isFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:is-fullscreen'),
    onFullscreen: (listener: (fullscreen: boolean) => void): (() => void) => {
        const handler = (_event: unknown, fullscreen: boolean): void => listener(fullscreen);
        ipcRenderer.on('window:fullscreen', handler);
        return () => ipcRenderer.removeListener('window:fullscreen', handler);
    },
    setTheme: (theme: { resolved: 'light' | 'dark'; followsSystem: boolean; background: string }): void => ipcRenderer.send('window:theme', theme),
    saveFile: (suggestedName: string, bytes: Uint8Array, mime: string): Promise<string | null> =>
        ipcRenderer.invoke('dialog:save-file', suggestedName, bytes, mime)
});
