import { existsSync, writeFileSync } from 'node:fs';
import { DESKTOP_APP_ORIGIN } from '@ruimte/contracts';
import { BrowserWindow, net, session } from 'electron';
import { STORAGE_MOVE_PATH } from './app-scheme';

/*
 * Once per profile, moves the page's `localStorage` from `http://127.0.0.1:<port>`, where the daemon used
 * to serve it, onto the app's scheme unless that already holds something. The client's non-extractable
 * key stays behind. The flag is written whatever happened, so a failure never costs a start.
 */
export async function moveLegacyStorage(port: number, flagPath: string): Promise<() => void> {
    if (existsSync(flagPath)) {
        return () => undefined;
    }
    const oldOrigin = `http://127.0.0.1:${port}`;
    const own = session.defaultSession;
    // One window for both origins, closed by the caller once an app window stands: the last window closing quits the app on Linux.
    const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    try {
        own.protocol.handle('http', (request) =>
            request.url === `${oldOrigin}${STORAGE_MOVE_PATH}`
                ? new Response('<!doctype html><title>Ruimte</title>', { headers: { 'content-type': 'text/html; charset=utf-8' } })
                : net.fetch(request, { bypassCustomProtocolHandlers: true })
        );
        let entries: Array<[string, string]>;
        try {
            await window.loadURL(`${oldOrigin}${STORAGE_MOVE_PATH}`);
            entries = JSON.parse(await window.webContents.executeJavaScript('JSON.stringify(Object.entries(localStorage))')) as Array<[string, string]>;
        } finally {
            own.protocol.unhandle('http');
        }
        if (entries.length > 0) {
            await window.loadURL(`${DESKTOP_APP_ORIGIN}${STORAGE_MOVE_PATH}`);
            await window.webContents.executeJavaScript(
                `(() => { if (localStorage.length > 0) { return; } for (const [key, value] of ${JSON.stringify(entries)}) { localStorage.setItem(key, value); } })()`
            );
        }
    } catch (e) {
        console.warn('Moving what the page kept under its old address failed:', e instanceof Error ? e.message : e);
    }
    writeFileSync(flagPath, `${new Date().toISOString()}\n`);
    return () => {
        if (!window.isDestroyed()) {
            window.destroy();
        }
    };
}
