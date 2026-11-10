import type { BrowserRouteBlocked } from '@ruimte/desktop-bridge';
import { tunnelDestinationAllowedFor } from './tunnel-policy';

/* As much of a guest's web contents as the guards of a tunnel use, so a test hands in a plainer one. */
export interface TunnelGuestContents {
    readonly id: number;
    on(event: 'will-frame-navigate' | 'will-redirect', listener: (event: { url: string; isMainFrame: boolean; preventDefault(): void }) => void): unknown;
    setWindowOpenHandler(handler: () => { action: 'deny' }): void;
    setWebRTCIPHandlingPolicy(policy: 'disable_non_proxied_udp'): void;
}

interface TunnelGuestOptions {
    /* Whether the guest sits in the window that made the tunnel. */
    owned(): boolean;
    port: number;
    blocked(message: BrowserRouteBlocked): void;
}

/*
 * What a page of a tunnel may do before its first load: go only to the one port, open no window, and use no
 * network of its own. WebRTC would otherwise reach STUN, TURN and UDP peers on the client's network, around the proxy.
 */
export function guardTunnelGuest(guest: TunnelGuestContents, options: TunnelGuestOptions): void {
    const guard = (event: { url: string; isMainFrame: boolean; preventDefault(): void }): void => {
        if (!tunnelDestinationAllowedFor(options.owned(), event.url, options.port)) {
            event.preventDefault();

            if (event.isMainFrame) {
                options.blocked({ webContentsId: guest.id, url: event.url });
            }
        }
    };

    guest.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    guest.on('will-frame-navigate', guard);
    guest.on('will-redirect', guard);
    guest.setWindowOpenHandler(() => ({ action: 'deny' }));
}
