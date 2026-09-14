import { LinkTransport, type LinkOpener, type SocketAddress } from './link-transport';

export type { SocketAddress } from './link-transport';

/* The wire as it always travelled: one WebSocket per connection, the credential in its URL. */
export const socketLink: LinkOpener = (url, events) => {
    const socket = new WebSocket(url);
    socket.onopen = () => events.open();
    socket.onmessage = (message) => events.message(String(message.data));
    socket.onclose = () => events.close(null);
    // The browser fires close right after error, so close owns the state change.
    socket.onerror = () => {};
    return {
        send: (data) => socket.send(data),
        close: () => socket.close()
    };
};

export class WebSocketTransport extends LinkTransport {
    constructor(address: SocketAddress) {
        super(address, socketLink);
    }
}
