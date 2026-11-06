import { useProposals } from '@/proposals/proposals';
import { pool } from '@/transport';
import { machineAnswers } from '@/transport/features';
import { joinWatches, snapshotWatch, watchPool, type WatchablePool } from '@/transport/pool-watch';

/*
 * The project suggestions of every machine this client holds a socket for. The machine tells every
 * socket the whole list whenever it changes; a socket that opens asks once, unless the machine is
 * older than the request.
 */
export function startProposalWatch(source: WatchablePool = pool): () => void {
    return watchPool(
        (link, endpointId) =>
            joinWatches(
                snapshotWatch(
                    link,
                    'chat.proposals',
                    'chat.proposals',
                    (payload) => useProposals.getState().setProposals(endpointId, payload.proposals),
                    () => machineAnswers(link.connection, 'chat.proposals')
                ),
                { subscriptions: [() => useProposals.getState().forget(endpointId)] }
            ),
        source
    );
}
