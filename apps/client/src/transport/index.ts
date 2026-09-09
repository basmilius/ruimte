import type { Transport } from './transport';
import { WebSocketTransport } from './websocket-transport';

export type { Transport, TransportStatus } from './transport';
export { TransportError } from './transport';

// Same origin on purpose: in dev Vite proxies /ws to the daemon, in production whatever
// serves the client also serves the socket, so the client never needs a configured address.
const socketUrl = (): string => {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${location.host}/ws`;
};

export const transport: Transport = new WebSocketTransport(socketUrl());
