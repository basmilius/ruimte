import { CodedError } from '@adecore/agents';
import type { Area } from '../area.ts';
import type { SessionPorts } from '../sessions/ports.ts';

interface SessionPortsDeps {
    ports: SessionPorts;
}

export function sessionPortsArea({ ports }: SessionPortsDeps): Area {
    return {
        name: 'session ports',
        handlers: (dispatcher) => {
            dispatcher.register('session.ports', ({ sessionId }) => ports.list(sessionId));
            dispatcher.register('session.verifyPort', ({ sessionId, listener }, client) => {
                // A remote client's browser does not share this machine's loopback interface.
                if (client.access?.sessionId !== null) {
                    throw new CodedError('session-port-route-unavailable', 'Open this port in Ruimte on the machine running the session');
                }
                return ports.verify(sessionId, listener);
            });
        },
        stop: [{ phase: 'halt', label: 'Stopping the port monitor', run: () => ports.stop() }]
    };
}
