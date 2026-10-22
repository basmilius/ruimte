import { useEffect, useRef } from 'react';
import type { ProjectView } from '@ruimte/contracts';
import { useViewNodes, type NodesOfView } from '@/project/view-nodes';
import { shallow } from 'zustand/shallow';
import { endpointById, endpointIdOfMachine, useEndpoints, type Endpoint } from '@/state/endpoints';
import { pool } from '@/transport';

/* The machines other than the workspace's that a node of the project runs on, each once. */
export function machinesOfNodes(views: readonly ProjectView[], nodesOf: NodesOfView, workspaceEndpointId: string): string[] {
    const machines = new Set<string>();
    for (const view of views) {
        for (const node of nodesOf(view)) {
            const endpointId = node.machine === undefined ? undefined : endpointIdOfMachine(node.machine);
            if (endpointId !== undefined && endpointId !== workspaceEndpointId) {
                machines.add(endpointId);
            }
        }
    }
    return [...machines].sort();
}

/*
 * One hold on the link of every machine a node of the open project runs on, for as long as the
 * workspace lives. A node draws from its own machine, so its link has to be up while the node is on
 * the canvas, whichever view is in front. Nothing else may keep a link up for a node.
 */
export class RemoteHolds {
    private readonly take: (endpoint: Endpoint) => () => void;
    private readonly held = new Map<string, () => void>();

    constructor(take: (endpoint: Endpoint) => () => void) {
        this.take = take;
    }

    /* Holds exactly these machines. One this client has no row for yet is taken when the row comes. */
    set(machines: readonly string[], endpoints: (id: string) => Endpoint | null | undefined): void {
        const wanted = new Set(machines);
        for (const [id, release] of [...this.held]) {
            if (!wanted.has(id)) {
                release();
                this.held.delete(id);
            }
        }
        for (const id of wanted) {
            const endpoint = endpoints(id);
            if (endpoint != null && !this.held.has(id)) {
                this.held.set(id, this.take(endpoint));
            }
        }
    }

    release(): void {
        this.set([], () => undefined);
    }
}

/* Called once by the workspace: keeps the links of the machines its nodes run on. */
export function useRemoteHolds(workspaceId: string): void {
    const machines = useViewNodes((views, nodesOf) => machinesOfNodes(views, nodesOf, workspaceId), shallow);
    // A row that turns up later (the account list arrives after the project) is held from then on.
    const rows = useEndpoints((state) => state.endpoints);
    const holds = useRef<RemoteHolds | null>(null);
    useEffect(() => {
        if (holds.current === null) {
            holds.current = new RemoteHolds((endpoint) => pool.hold(endpoint));
        }
        holds.current.set(machines, endpointById);
    }, [machines, rows]);
    useEffect(
        () => () => {
            holds.current?.release();
        },
        []
    );
}
