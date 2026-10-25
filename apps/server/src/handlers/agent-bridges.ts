import { RequestError, type Dispatcher } from '../dispatcher.ts';
import type { AgentBridges } from '../peering/agent-bridges.ts';

/* Client requests make the two grants. A peer can only send to a grant already made for its authenticated machine. */
export function registerAgentBridgeHandlers(dispatcher: Dispatcher, bridges: AgentBridges): void {
    dispatcher.register('bridge.list', ({ nodeId }) => ({ bridges: bridges.list(nodeId) }));
    dispatcher.register('bridge.candidates', ({ projectId }) => ({ agents: bridges.candidates(projectId) }));
    dispatcher.register('bridge.bind', async (payload) => {
        await bridges.bind(payload);
        return {};
    });
    dispatcher.register('bridge.remove', async ({ id }) => {
        await bridges.remove(id);
        return {};
    });
    dispatcher.register(
        'peer.message',
        (payload, client) => {
            const machineId = client.access?.peer?.machineId;
            if (machineId === undefined) {
                throw new RequestError('forbidden', 'Only an authenticated machine may deliver an agent message');
            }
            return bridges.receive(machineId, payload);
        },
        { peer: true }
    );
}
