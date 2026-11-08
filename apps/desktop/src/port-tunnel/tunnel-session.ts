import { randomBytes, randomUUID } from 'node:crypto';
import type { BrowserRouteBlocked, PortTunnelOpened } from '@ruimte/desktop-bridge';
import { electron } from '../main/electron';
import { allowGuestPermission, TUNNEL_PARTITION_PREFIX } from '../web-guards';
import { IpcRelay } from './ipc-relay';
import { parseToShell, parseTunnelRequest } from './messages';
import { PROXY_REALM, PROXY_USER } from './proxy-connection';
import { RefusedBatch } from './refused-batch';
import { startProxyListener, type ProxyListener } from './proxy-listener';
import { tunnelDestinationAllowedFor } from './tunnel-policy';
import { markTunnelSession } from './tunnel-sessions';

const { app, ipcMain, session } = electron;

/* A window with this many tunnels open is not a person with pages open. */
const MAX_TUNNELS_PER_WINDOW = 8;

interface Tunnel {
    readonly id: string;
    readonly partition: string;
    readonly host: Electron.WebContents;
    readonly session: Electron.Session;
    readonly port: number;
    readonly relay: IpcRelay;
    readonly listener: ProxyListener;
}

export interface PortTunnels {
    /* Whether the window made this partition itself, which is all that lets one of its `<webview>` elements name it. */
    owns(host: Electron.WebContents, partition: string): boolean;
}

/*
 * Pages of a shared port on another machine. Each tunnel is a session of its own that exists only in memory, a
 * proxy on loopback that only this session logs in to, and the messages of `IpcRelay` to the window that made it.
 * Every guard of the session is in place before the partition is told to the page, so the first load of a guest
 * is already held to the one port of the grant.
 */
export function installPortTunnels(isAppSender: (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => boolean, guestPreload: string): PortTunnels {
    const tunnels = new Map<string, Tunnel>();
    const bySession = new Map<Electron.Session, Tunnel>();

    const close = (tunnel: Tunnel, reason: string): void => {
        if (tunnels.delete(tunnel.id) === false) {
            return;
        }

        bySession.delete(tunnel.session);
        tunnel.relay.closeAll(reason);
        tunnel.listener.stop();
        void tunnel.session.closeAllConnections().catch(() => undefined);
        void tunnel.session.clearStorageData().catch(() => undefined);
        void tunnel.session.clearCache().catch(() => undefined);
    };

    // The proxy asks for a login once per realm; only the guest of the session this proxy belongs to is answered, and a site's own 401 never is.
    app.on('login', (event, contents, _request, authInfo, callback) => {
        const tunnel = contents === null ? undefined : bySession.get(contents.session);

        if (
            tunnel === undefined ||
            !authInfo.isProxy ||
            authInfo.host !== '127.0.0.1' ||
            authInfo.port !== tunnel.listener.port ||
            authInfo.realm !== PROXY_REALM
        ) {
            return;
        }

        event.preventDefault();
        callback(PROXY_USER, tunnel.listener.secret);
    });

    app.on('web-contents-created', (_event, guest) => {
        const tunnel = bySession.get(guest.session);

        if (tunnel === undefined || guest.getType() !== 'webview') {
            return;
        }

        const owned = (): boolean => guest.hostWebContents === tunnel.host;
        const guard = (event: { url: string; isMainFrame: boolean; preventDefault(): void }): void => {
            if (!tunnelDestinationAllowedFor(owned(), event.url, tunnel.port)) {
                event.preventDefault();

                if (event.isMainFrame && !tunnel.host.isDestroyed()) {
                    tunnel.host.send('browser:route-blocked', { webContentsId: guest.id, url: event.url } satisfies BrowserRouteBlocked);
                }
            }
        };

        guest.on('will-frame-navigate', guard);
        guest.on('will-redirect', guard);
        guest.setWindowOpenHandler(() => ({ action: 'deny' }));
    });

    ipcMain.handle('port-tunnel:open', async (event, value: unknown): Promise<PortTunnelOpened | null> => {
        const request = parseTunnelRequest(value);

        if (!isAppSender(event) || event.senderFrame !== event.sender.mainFrame || request === null) {
            return null;
        }

        const host = event.sender;

        if ([...tunnels.values()].filter((tunnel) => tunnel.host === host).length >= MAX_TUNNELS_PER_WINDOW) {
            return null;
        }

        const id = randomUUID();
        const partition = `${TUNNEL_PARTITION_PREFIX}${randomBytes(16).toString('hex')}`;
        const relay = new IpcRelay(id, (message) => {
            if (!host.isDestroyed()) {
                host.send('port-tunnel:message', message);
            }
        });
        const listener = await startProxyListener({ relay, port: request.port, refused: () => undefined });
        const ses = session.fromPartition(partition);
        const tunnel: Tunnel = { id, partition, host, session: ses, port: request.port, relay, listener };

        markTunnelSession(ses);
        bySession.set(ses, tunnel);
        tunnels.set(id, tunnel);

        ses.registerPreloadScript({ type: 'frame', id: 'ruimte-guest', filePath: guestPreload });
        ses.setPermissionRequestHandler((_contents, permission, callback) => callback(allowGuestPermission(permission)));
        ses.setPermissionCheckHandler((_contents, permission) => allowGuestPermission(permission));
        ses.setDevicePermissionHandler(() => false);
        const refused = new RefusedBatch(
            (webContentsId, url, count) => {
                if (!host.isDestroyed()) {
                    host.send('browser:route-blocked', { webContentsId, url, subresource: true, count } satisfies BrowserRouteBlocked);
                }
            },
            (ms, fire) => void setTimeout(fire, ms)
        );

        ses.webRequest.onBeforeRequest((details, callback) => {
            const guest = details.webContents;
            const allowed = tunnelDestinationAllowedFor(guest !== undefined && guest.hostWebContents === host, details.url, tunnel.port);

            if (!allowed && guest !== undefined && !host.isDestroyed()) {
                if (details.resourceType === 'mainFrame') {
                    host.send('browser:route-blocked', { webContentsId: guest.id, url: details.url } satisfies BrowserRouteBlocked);
                } else {
                    refused.add(guest.id, details.url);
                }
            }

            callback({ cancel: !allowed });
        });

        try {
            // Chromium leaves loopback out of a proxy unless told otherwise, and the page must not reach this computer's own.
            await ses.setProxy({ mode: 'fixed_servers', proxyRules: `http://127.0.0.1:${listener.port}`, proxyBypassRules: '<-loopback>' });
        } catch {
            close(tunnel, 'The page could not be sent through the proxy');

            return null;
        }

        host.once('destroyed', () => close(tunnel, 'The window closed'));
        host.on('render-process-gone', () => close(tunnel, 'The window stopped'));
        // A reload of the app's page forgets the streams it held, so the tunnels it made go with it.
        host.on('did-start-navigation', (details) => {
            if (details.isMainFrame && !details.isSameDocument) {
                close(tunnel, 'The window reloaded');
            }
        });

        return { id, partition };
    });

    ipcMain.on('port-tunnel:send', (event, value: unknown) => {
        const message = parseToShell(value);
        const tunnel = message === null ? undefined : tunnels.get(message.id);

        if (message === null || tunnel === undefined || tunnel.host !== event.sender || !isAppSender(event) || event.senderFrame !== event.sender.mainFrame) {
            return;
        }

        tunnel.relay.receive(message);
    });

    ipcMain.on('port-tunnel:close', (event, id: unknown) => {
        const tunnel = typeof id === 'string' ? tunnels.get(id) : undefined;

        if (tunnel !== undefined && tunnel.host === event.sender && isAppSender(event)) {
            close(tunnel, 'The page closed it');
        }
    });

    return {
        owns: (host, partition) => [...tunnels.values()].some((tunnel) => tunnel.host === host && tunnel.partition === partition)
    };
}
