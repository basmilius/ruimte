import type { CanvasNode } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { endpointOfNode } from '@/state/keys';
import { nodesOfView } from '@/state/view-nodes';
import { currentEndpointId } from './current-endpoint';

/*
 * The machine a node or a view of the open project runs on, for code that has no subtree to ask:
 * the one a node names, else the workspace's. A view of its own always runs on the workspace's machine.
 */
export function endpointOfNodeId(nodeId: string): string {
    const node = nodeOfId(nodeId);
    return node === undefined ? currentEndpointId() : endpointOfNode(node, currentEndpointId());
}

/* The machine a node of the open project names, by the daemon's id; undefined for one that runs on the workspace's machine. */
export function machineOfNodeId(nodeId: string): string | undefined {
    return nodeOfId(nodeId)?.machine;
}

function nodeOfId(nodeId: string): CanvasNode | undefined {
    for (const view of useDocument.getState().views) {
        const node = nodesOfView(view).find((candidate) => candidate.id === nodeId);
        if (node !== undefined) {
            return node;
        }
    }
    return undefined;
}
