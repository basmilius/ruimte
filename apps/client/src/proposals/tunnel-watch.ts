import { TunnelProposalActionSchema, type FromMachine, type TunnelProposal } from '@ruimte/contracts';
import { useTunnelProposals } from '@/state/tunnel-proposals';
import { pool } from '@/transport';
import { knownWord } from '@/transport-api/known-word';
import { machineAnswers } from '@/transport/features';
import { joinWatches, snapshotWatch, watchPool, type WatchablePool } from '@/transport/pool-watch';

/* A card for a change this version cannot name stays out: it could not say what a confirm would do. */
function readableProposal(proposal: FromMachine<TunnelProposal>): TunnelProposal[] {
    const action = knownWord(TunnelProposalActionSchema.options, proposal.action);

    return action === null ? [] : [{ ...proposal, action }];
}

/*
 * The tunnel suggestions of every machine this client holds a socket for. The machine tells every socket the whole
 * list whenever it changes; a socket that opens asks once, unless the machine is older than the request.
 */
export function startTunnelProposalWatch(source: WatchablePool = pool): () => void {
    return watchPool(
        (link, endpointId) =>
            joinWatches(
                snapshotWatch(
                    link,
                    'tunnel.proposals',
                    'tunnel.proposals',
                    (payload) => useTunnelProposals.getState().setProposals(endpointId, payload.proposals.flatMap(readableProposal)),
                    () => machineAnswers(link.connection, 'tunnel.proposals')
                ),
                { subscriptions: [() => useTunnelProposals.getState().forget(endpointId)] }
            ),
        source
    );
}
