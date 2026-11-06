import type { NodeActivity } from '@ruimte/contracts';
import { create } from 'zustand';
import { projectNodes } from '@/project/view-nodes';
import { currentEndpointId, dropEndpoint, endpointKey, endpointOfNode, isOfEndpoint } from '@/state/keys';
import { onNodeActivated } from '@/state/node-activation';
import { readOnEveryOpen, type Transport } from '@/transport/transport';

/*
 * When each node last changed for a person, on its machine's clock: its agent started, waited, stopped
 * or finished, or a person opened it. The machine keeps it (`activity.list`), so every client lists a
 * canvas in the same order. A machine older than `activity.list` leaves a node without one.
 */
export type NodeActivities = Readonly<Record<string, number>>;

interface NodeActivityStore {
    byKey: NodeActivities;

    /* `whole` replaces what the machine had; otherwise only the nodes that changed. */
    receive(endpointId: string, activity: readonly Pick<NodeActivity, 'nodeId' | 'at'>[], whole: boolean): void;
    forget(endpointId: string): void;
}

export const useNodeActivity = create<NodeActivityStore>((set, get) => ({
    byKey: {},
    receive(endpointId, activity, whole) {
        const byKey: Record<string, number> = whole ? dropEndpoint(get().byKey, endpointId) : { ...get().byKey };

        for (const { nodeId, at } of activity) {
            byKey[endpointKey(endpointId, nodeId)] = at;
        }

        set({ byKey });
    },
    forget(endpointId) {
        set({ byKey: dropEndpoint(get().byKey, endpointId) });
    }
}));

export function activityOf(activities: NodeActivities, endpointId: string, nodeId: string): number | null {
    return activities[endpointKey(endpointId, nodeId)] ?? null;
}

/* Whether no other node of that machine changed later, so touching it again would move nothing. */
function isLatest(activities: NodeActivities, key: string, endpointId: string): boolean {
    const at = activities[key];

    if (at === undefined) {
        return false;
    }

    return Object.entries(activities).every(([other, otherAt]) => other === key || !isOfEndpoint(other, endpointId) || otherAt <= at);
}

/* The link to each machine that keeps activity, which is where a touch goes. */
const machines = new Map<string, Transport>();

function touch(nodeId: string): void {
    const node = projectNodes().find((candidate) => candidate.id === nodeId);

    if (node === undefined) {
        return;
    }

    const endpointId = endpointOfNode(node, currentEndpointId());
    const transport = machines.get(endpointId);

    if (transport === undefined || transport.status !== 'open' || isLatest(useNodeActivity.getState().byKey, endpointKey(endpointId, nodeId), endpointId)) {
        return;
    }

    // The node may be in no project on that machine, such as one bound to it from here; it then has no activity.
    void transport.request('activity.touch', { nodeId }).catch(() => undefined);
}

/* One machine's activity: all of it on every fresh link, and every change after. `answers` says whether it keeps any. */
export function watchNodeActivity(endpointId: string, transport: Transport, answers: () => boolean): () => void {
    let generation = 0;

    const refresh = (): void => {
        const current = ++generation;

        if (!answers()) {
            machines.delete(endpointId);
            useNodeActivity.getState().forget(endpointId);

            return;
        }

        machines.set(endpointId, transport);
        transport
            .request('activity.list', {})
            .then(({ activity }) => {
                if (current === generation) {
                    useNodeActivity.getState().receive(endpointId, activity, true);
                }
            })
            // A failed ask leaves the activity as it was; the next open link asks again.
            .catch(() => undefined);
    };

    const offEvent = transport.on('activity.changed', ({ activity }) => useNodeActivity.getState().receive(endpointId, activity, false));
    const offStatus = readOnEveryOpen(transport, refresh);

    return () => {
        generation++;
        offEvent();
        offStatus();

        if (machines.get(endpointId) === transport) {
            machines.delete(endpointId);
        }

        useNodeActivity.getState().forget(endpointId);
    };
}

/* Tells the machine whenever a person opens a node. */
export function startNodeActivityTouches(): () => void {
    return onNodeActivated(touch);
}
