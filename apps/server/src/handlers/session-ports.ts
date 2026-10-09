import { RequestError, type Dispatcher } from '../dispatcher.ts';
import type { SessionPorts } from '../sessions/ports.ts';

export function registerSessionPortHandlers(dispatcher: Dispatcher, ports: SessionPorts): void {
    dispatcher.register('session.ports', ({ sessionId }) => ports.list(sessionId));
    dispatcher.register('session.verifyPort', ({ sessionId, listener }, client) => {
        // A remote client's browser does not share this machine's loopback interface.
        if (client.access?.sessionId !== null) {
            throw new RequestError('session-port-route-unavailable', 'Open this port in Ruimte on the machine running the session');
        }
        return ports.verify(sessionId, listener);
    });
}
