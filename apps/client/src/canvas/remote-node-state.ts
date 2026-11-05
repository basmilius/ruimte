import { useRemoteRefusals } from '@/project/remote-refusals';
import { useEndpoints } from '@/state/endpoints';
import type { ConnectionState } from '@/transport-api/transport';
import { machineAnswers } from '@/transport/features';
import { useEndpointConnection } from '@/transport/status';

/*
 * What a node that runs on another machine can do right now. `ready` is the usual body, loading
 * included; the others replace the body with a card that says why, since drawing a terminal or a
 * thread from a machine that is not there only shows an error in it.
 */
export type RemoteNodeState = 'ready' | 'connecting' | 'offline' | 'unlinked' | 'too-old';

function remoteNodeStateOf(input: {
    known: boolean;
    connection: Pick<ConnectionState, 'status' | 'attempts' | 'failure' | 'features'>;
    unlinked: boolean;
}): RemoteNodeState {
    const { known, connection, unlinked } = input;
    if (!known) {
        return 'offline';
    }
    if (connection.status !== 'open') {
        // A link that has not tried yet is a node that is still loading, not one that is lost.
        if (connection.attempts === 0 && !connection.failure) {
            return 'ready';
        }
        return connection.status === 'connecting' ? 'connecting' : 'offline';
    }
    if (!machineAnswers(connection, 'peer.placeNodes')) {
        return 'too-old';
    }
    return unlinked ? 'unlinked' : 'ready';
}

/* The state of a node's machine; `ready` for a node that runs on the workspace's own. */
export function useRemoteNodeState(machine: string | undefined, workspaceId: string | undefined): RemoteNodeState {
    const rows = useEndpoints((state) => state.endpoints);
    const endpointId = machine === undefined ? null : (rows.find((row) => row.id === machine || row.daemonId === machine)?.id ?? machine);
    const remote = endpointId !== null && endpointId !== workspaceId ? endpointId : null;
    const connection = useEndpointConnection(remote ?? '');
    // The mirror refuses a machine by the id the node names it with.
    const unlinked = useRemoteRefusals((state) => (machine === undefined || remote === null ? false : state.unlinked[machine] === true));
    if (remote === null) {
        return 'ready';
    }
    return remoteNodeStateOf({ known: rows.some((row) => row.id === remote), connection, unlinked });
}
