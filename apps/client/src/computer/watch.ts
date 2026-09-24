import { useComputer } from '@/state/computer';
import { watchPool } from '@/transport/pool-watch';

/*
 * The computer use cards of every machine this client holds a socket for. The daemon tells every
 * socket the whole list whenever it changes; a socket that opens asks for it once.
 */
export const startComputerWatch = (): (() => void) =>
    watchPool((link, endpointId) => ({
        onOpen: () => {
            // A daemon from before computer use does not know the request; it simply has no cards.
            link.request('computer.approvals', {})
                .then((result) => useComputer.getState().setApprovals(endpointId, result.approvals))
                .catch(() => undefined);
        },
        subscriptions: [
            link.on('computer.approvals', (payload) => useComputer.getState().setApprovals(endpointId, payload.approvals)),
            () => useComputer.getState().forget(endpointId)
        ]
    }));
