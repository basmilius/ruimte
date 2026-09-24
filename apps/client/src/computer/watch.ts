import { useComputer } from '@/state/computer';
import { watchPool } from '@/transport/pool-watch';

/*
 * The computer use cards and status of every machine this client holds a socket for. The daemon tells
 * every socket the whole list and the status whenever they change; a socket that opens asks once.
 */
export const startComputerWatch = (): (() => void) =>
    watchPool((link, endpointId) => ({
        onOpen: () => {
            // A daemon from before computer use does not know the requests; it simply has no cards and no status.
            link.request('computer.approvals', {})
                .then((result) => useComputer.getState().setApprovals(endpointId, result.approvals))
                .catch(() => undefined);
            link.request('computer.status', {})
                .then((status) => useComputer.getState().setStatus(endpointId, status))
                .catch(() => undefined);
        },
        subscriptions: [
            link.on('computer.approvals', (payload) => useComputer.getState().setApprovals(endpointId, payload.approvals)),
            link.on('computer.status', (payload) => useComputer.getState().setStatus(endpointId, payload)),
            () => useComputer.getState().forget(endpointId)
        ]
    }));
