import { PROTOCOL_REFUSED_CLOSE_CODE, protocolMismatch, protocolOfRefusal } from '@ruimte/contracts';
import { LinkTransport, type LinkOpener, type SocketAddress } from './link-transport';
import { protocolGate, protocolRefusal, withProtocol } from './protocol';

export type { SocketAddress } from './link-transport';

/* The wire as it always travelled: one WebSocket per connection, the credential in its URL. */
export const socketLink: LinkOpener = (url, events) => {
    const socket = new WebSocket(withProtocol(url));
    let refused = false;
    const gate = protocolGate({
        send: (data) => socket.send(data),
        open: () => events.open(),
        message: (data) => events.message(data),
        refuse: (failure) => {
            refused = true;
            events.close(failure);
            socket.close();
        }
    });
    socket.onopen = () => gate.opened();
    socket.onmessage = (message) => gate.received(String(message.data));
    socket.onclose = (event) => {
        if (refused) {
            return;
        }
        const daemon = event.code === PROTOCOL_REFUSED_CLOSE_CODE ? protocolOfRefusal(event.reason) : null;
        const mismatch = daemon === null ? null : protocolMismatch(daemon);
        events.close(mismatch === null ? null : protocolRefusal(mismatch));
    };
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
