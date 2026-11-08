// A plain require: the bundle keeps electron external and this is the sandboxed preload of the measurement window.
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

contextBridge.exposeInMainWorld('harness', {
    openPortTunnel: (request: unknown) => ipcRenderer.invoke('port-tunnel:open', request),
    openProtocolTunnel: (request: unknown) => ipcRenderer.invoke('harness:open-protocol', request),
    closeTunnel: (id: string) => {
        ipcRenderer.send('port-tunnel:close', id);
        ipcRenderer.send('harness:close', id);
    },
    portTunnelSend: (message: unknown) => ipcRenderer.send('port-tunnel:send', message),
    onPortTunnel: (listener: (message: unknown) => void) => {
        const handler = (_event: unknown, message: unknown): void => listener(message);

        ipcRenderer.on('port-tunnel:message', handler);

        return () => {
            ipcRenderer.removeListener('port-tunnel:message', handler);
        };
    },
    ipcEcho: (bytes: Uint8Array) => ipcRenderer.send('harness:ipc-echo', bytes),
    onIpcEcho: (listener: (bytes: Uint8Array) => void) => {
        ipcRenderer.on('harness:ipc-echo', (_event, bytes: Uint8Array) => listener(bytes));
    },
    machineUrl: process.argv.find((arg) => arg.startsWith('--machine='))?.slice('--machine='.length) ?? ''
});
