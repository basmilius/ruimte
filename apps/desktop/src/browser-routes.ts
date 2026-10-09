import type { BrowserRouteBinding, BrowserRouteBlocked } from '@ruimte/desktop-bridge';
import { browserDestinationAllowed, parseBrowserRoute } from './browser-route-policy';
import { allowGuestPermission, BROWSER_PARTITION, hardenGuestPreferences } from './web-guards';

const { app, ipcMain, session, webContents } = require('electron') as typeof import('electron');

/* One policy per actual guest, even though cookies and permissions share a session. The app binds
   an attached blank guest; neither its page nor a different app window can claim that guest. */
export function installBrowserRoutes(
    isAppSender: (event: Electron.IpcMainInvokeEvent) => boolean,
    guestPreload: string
): {
    attachApp(contents: Electron.WebContents): void;
} {
    const browser = session.fromPartition(BROWSER_PARTITION);
    const routes = new Map<Electron.WebContents, BrowserRouteBinding>();
    const bootstraps = new WeakSet<Electron.WebContents>();
    browser.registerPreloadScript({ type: 'frame', id: 'ruimte-guest', filePath: guestPreload });
    browser.setPermissionRequestHandler((_contents, permission, callback) => callback(allowGuestPermission(permission)));
    browser.setPermissionCheckHandler((_contents, permission) => allowGuestPermission(permission));
    browser.setDevicePermissionHandler(() => false);

    function blocked(guest: Electron.WebContents | undefined, url: string): void {
        const host = guest?.hostWebContents;
        if (guest && !guest.isDestroyed() && host && !host.isDestroyed()) {
            host.send('browser:route-blocked', { webContentsId: guest.id, url } satisfies BrowserRouteBlocked);
        }
    }

    // Request interception also covers loadURL, history, cached responses and subresources, which
    // will-navigate alone misses. Unattributed requests cannot establish a machine-owner route.
    browser.webRequest.onBeforeRequest((details, callback) => {
        const guest = details.webContents;
        const allowed = browserDestinationAllowed(guest ? routes.get(guest) : undefined, details.url);
        if (!allowed && details.resourceType === 'mainFrame') {
            blocked(guest, details.url);
        }
        callback({ cancel: !allowed });
    });

    app.on('web-contents-created', (_event, guest) => {
        if (guest.getType() !== 'webview' || guest.session !== browser) {
            return;
        }
        guest.on('will-frame-navigate', (event) => {
            if (!browserDestinationAllowed(routes.get(guest), event.url)) {
                event.preventDefault();
                if (event.isMainFrame) {
                    blocked(guest, event.url);
                }
            }
        });
        guest.on('will-redirect', (event) => {
            if (!browserDestinationAllowed(routes.get(guest), event.url)) {
                event.preventDefault();
                if (event.isMainFrame) {
                    blocked(guest, event.url);
                }
            }
        });
        const finishBootstrap = (): void => {
            if (guest.getURL() === 'about:blank' || !bootstraps.delete(guest)) {
                return;
            }
            // Only the captured handshake entry disappears; all visited pages keep their history.
            const history = guest.navigationHistory;
            if (history.getActiveIndex() > 0 && history.getEntryAtIndex(0).url === 'about:blank') {
                history.removeEntryAtIndex(0);
            }
        };
        guest.on('did-navigate', finishBootstrap);
        // Chromium's error document can commit without did-navigate.
        guest.on('did-stop-loading', finishBootstrap);
        guest.setWindowOpenHandler(() => ({ action: 'deny' }));
        guest.once('destroyed', () => routes.delete(guest));
    });

    ipcMain.handle('browser:bind-route', (event, value: unknown): boolean => {
        const route = parseBrowserRoute(value);
        if (!isAppSender(event) || event.senderFrame !== event.sender.mainFrame || !route) {
            return false;
        }
        const guest = webContents.fromId(route.webContentsId);
        if (!guest || guest.isDestroyed() || guest.getType() !== 'webview' || guest.session !== browser || guest.hostWebContents !== event.sender) {
            return false;
        }
        const bound = routes.get(guest);
        if (bound) {
            return bound.endpointId === route.endpointId && bound.owner === route.owner && bound.localMachineId === route.localMachineId;
        }
        // Restored user history is never bootstrap, even when its selected page is blank.
        if (guest.navigationHistory.length() === 1 && guest.navigationHistory.getEntryAtIndex(0).url === 'about:blank') {
            bootstraps.add(guest);
        }
        routes.set(guest, route);
        return true;
    });

    return {
        attachApp(contents) {
            contents.on('will-attach-webview', (event, preferences) => {
                if (!hardenGuestPreferences(preferences)) {
                    event.preventDefault();
                }
            });
        }
    };
}
