import type { SignalEnvelope } from '@ruimte/pulsar';
import { sendEvent, type Dispatcher } from '../dispatcher.ts';

interface SignalSink {
    receive(envelope: SignalEnvelope, reply: (envelope: SignalEnvelope) => void): void;
}

/*
 * Signaling for a direct connection over a socket the client already holds. The socket only carries
 * the signals. The channel they open runs a handshake of its own and gets none of this socket's access.
 */
export const registerDirectHandlers = (dispatcher: Dispatcher, peers: SignalSink): void => {
    dispatcher.register('direct.signal', (payload, client) => {
        peers.receive(payload.envelope, (envelope) => sendEvent(client, 'direct.signaled', { envelope }));
        return {};
    });
};
