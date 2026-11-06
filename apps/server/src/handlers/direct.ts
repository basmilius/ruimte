import type { SignalEnvelope } from '@ruimte/pulsar';
import type { Area } from '../area.ts';
import { sendEvent } from '../wire.ts';

export interface DirectDeps {
    peers: {
        receive(envelope: SignalEnvelope, reply: (envelope: SignalEnvelope) => void): void;
        closeAll(): void;
    };
}

/*
 * Signaling for a direct connection over a socket the client already holds. The socket only carries
 * the signals. The channel they open runs a handshake of its own and gets none of this socket's access.
 */
export function directArea({ peers }: DirectDeps): Area {
    return {
        name: 'direct',
        handlers: (dispatcher) => {
            dispatcher.register('direct.signal', (payload, client) => {
                peers.receive(payload.envelope, (envelope) => sendEvent(client, 'direct.signaled', { envelope }));
                return {};
            });
        },
        stop: [{ phase: 'last', label: 'Closing direct channels', run: () => peers.closeAll() }]
    };
}
