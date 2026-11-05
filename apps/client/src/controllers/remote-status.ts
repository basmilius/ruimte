import type { RemoteStatusEvent } from '@ruimte/contracts';
import { create } from 'zustand';
import { watchPool } from '@/transport/pool-watch';

interface RemoteStatusStore {
    /* Per machine the work is done on, then per machine it is given to. */
    byEndpoint: Readonly<Record<string, Readonly<Record<string, RemoteStatusEvent>>>>;
    receive(endpointId: string, status: RemoteStatusEvent): void;
    forget(endpointId: string): void;
}

/* Where the link from a machine to the machines it works in stands, as that machine told this window. */
export const useRemoteStatus = create<RemoteStatusStore>((set, get) => ({
    byEndpoint: {},
    receive(endpointId, status) {
        const { [status.machineId]: _gone, ...others } = get().byEndpoint[endpointId] ?? {};
        // A closed link is the machine saying nothing waits on it any more.
        const next = status.state === 'closed' ? others : { ...others, [status.machineId]: status };
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: next } });
    },
    forget(endpointId) {
        const { [endpointId]: _gone, ...rest } = get().byEndpoint;
        set({ byEndpoint: rest });
    }
}));

/*
 * Whether the task of this node has not been asked of its machine yet, because the link is not open.
 * An open link is about to ask, so it counts as started; the standing says which nodes the machine
 * still waits on, and a task the machine took is no longer among them.
 */
export function isUnstarted(status: RemoteStatusEvent | undefined, nodeId: string): boolean {
    return status !== undefined && status.state !== 'open' && status.unstartedNodeIds?.includes(nodeId) === true;
}

/*
 * Whether the machine has not taken the task of this node yet, whatever state the link is in, so a window
 * does not start the chat there ahead of it. The daemon holds a standing while work for the machine is
 * owed, so a missing one is a task too new to be told of.
 */
export function isUntaken(status: RemoteStatusEvent | undefined, nodeId: string, taskOpen = false): boolean {
    return status === undefined ? taskOpen : status.unstartedNodeIds?.includes(nodeId) === true;
}

/*
 * The standing answer comes again with every fresh socket, so what a lost socket held is dropped
 * rather than shown as it was.
 */
export function startRemoteStatusWatch(): () => void {
    return watchPool((link, endpointId) => {
        const offStatus = link.subscribeStatus((status) => {
            if (status !== 'open') {
                useRemoteStatus.getState().forget(endpointId);
            }
        });
        return {
            subscriptions: [
                link.on('remote.status', (payload) => useRemoteStatus.getState().receive(endpointId, payload)),
                offStatus,
                () => useRemoteStatus.getState().forget(endpointId)
            ]
        };
    });
}
