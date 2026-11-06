import type { ServerWebSocket } from 'bun';
import type { Handshake } from '../auth/handshake.ts';
import { connectionOpener, type ConnectionHost, type OpenConnection, type SocketChannel } from '../connection.ts';
import { sendEvent, type ClientAccess, type ClientChannel } from '../wire.ts';

interface SocketConnection {
    channel: SocketChannel;
    connection: OpenConnection;
}

export interface DirectConnection {
    channel: ClientChannel;
    connection: OpenConnection;
}

/* Every client connected now, over a socket or a direct channel. */
export interface ClientsBundle {
    sockets: Map<ServerWebSocket<ClientAccess>, SocketConnection>;
    direct: Set<DirectConnection>;
    open(channel: ClientChannel, access: ClientAccess): OpenConnection;
    /* Opens and registers a direct channel that proved itself, or closes it when its session was revoked while it opened. */
    addDirect(channel: ClientChannel, access: ClientAccess): DirectConnection | null;
    /* Revoking must take effect now, not at the next connection, so a session's sockets and channels close here. */
    disconnectSession(sessionId: string): void;
    /* Tells a machine that works here its task settled, over the link it holds now; nothing when it holds none. */
    notifyPeer(machineId: string, nodeId: string): void;
}

export function wireClients(handshake: Handshake, host: ConnectionHost): ClientsBundle {
    const sockets = new Map<ServerWebSocket<ClientAccess>, SocketConnection>();
    const direct = new Set<DirectConnection>();
    const disconnectSession = (sessionId: string): void => {
        handshake.revoke(sessionId);
        for (const { channel, connection } of [...sockets.values(), ...direct]) {
            if (connection.client.access?.sessionId === sessionId) {
                channel.close(4001, 'Access revoked');
            }
        }
    };
    const notifyPeer = (machineId: string, nodeId: string): void => {
        for (const { connection } of [...sockets.values(), ...direct]) {
            if (connection.client.access?.peer?.machineId === machineId) {
                sendEvent(connection.client, 'peer.taskSettled', { nodeId });
            }
        }
    };
    const open = connectionOpener(host);

    const addDirect = (channel: ClientChannel, access: ClientAccess): DirectConnection | null => {
        // Checked as it is registered, with no await between, so a later revoke finds it in `direct` instead.
        if (access.sessionId !== null && !handshake.granted(access.sessionId)) {
            channel.close(4001, 'Access revoked');

            return null;
        }

        const state = { channel, connection: open(channel, access) };
        direct.add(state);
        channel.onClose(() => direct.delete(state));

        return state;
    };

    return { sockets, direct, open, addDirect, disconnectSession, notifyPeer };
}
