/*
 * A shared development port opened in a browser node of the desktop app. The shell holds a session of its own
 * for the page and a proxy listener on loopback; the bytes of the page travel to the client of the window as
 * the closed set of messages below, and from there to the machine over the connection it already has.
 */

export interface PortTunnelRequest {
    /* The machine the port is shared on, as the client names it; the shell stores it and never reads it. */
    endpointId: string;
    grantId: string;
    /* The one port the page may reach, which the shell holds every request of the page to. */
    port: number;
}

export interface PortTunnelOpened {
    id: string;
    /* The partition a `<webview>` of this tunnel names. Only the window that opened the tunnel may attach to it. */
    partition: string;
}

/* Shell to page: what the proxy asks of the machine connection. */
export type PortTunnelToPage =
    | { kind: 'open'; id: string; stream: number }
    | { kind: 'write'; id: string; stream: number; data: Uint8Array }
    | { kind: 'consumed'; id: string; stream: number; bytes: number }
    | { kind: 'closeWrite'; id: string; stream: number }
    | { kind: 'close'; id: string; stream: number };

/* Page to shell: what the machine connection answered. `flushed` counts the bytes the machine wrote to the service in all. */
export type PortTunnelToShell =
    | { kind: 'opened'; id: string; stream: number; error: string | null }
    | { kind: 'data'; id: string; stream: number; data: Uint8Array }
    | { kind: 'flushed'; id: string; stream: number; bytes: number }
    | { kind: 'end'; id: string; stream: number; reason: string | null };

/* The most bytes one `write` or `data` message carries, so a message stays small whatever the page sends. */
export const PORT_TUNNEL_MESSAGE_BYTES = 64 * 1024;

/* The bytes toward the machine that may be unanswered, per stream. */
export const PORT_TUNNEL_WINDOW_BYTES = 256 * 1024;

export const PORT_TUNNEL_MAX_STREAMS = 16;
