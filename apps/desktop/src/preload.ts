// A plain require: the bundler's ESM interop copies enumerable keys, and electron's are getters.
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

/* What the client may ask the shell for. The shape is mirrored in `apps/client/src/desktop/bridge.ts`. */
contextBridge.exposeInMainWorld('ruimteDesktop', {
    platform: process.platform,
    pickFolder: (initialPath?: string): Promise<string | null> => ipcRenderer.invoke('dialog:pick-folder', initialPath),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),
    openGuestDevTools: (webContentsId: number): void => ipcRenderer.send('devtools:guest', webContentsId)
});
