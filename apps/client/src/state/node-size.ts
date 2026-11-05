import { nodeSizeOf, type NodeKind, type NodeSize, type NodeSizes } from '@ruimte/contracts';
import { serverInfoOf } from '@/state/server';
import { currentEndpointId } from './current-endpoint';

/*
 * The sizes a person gave new nodes on a machine. A window shows one project on one machine, so
 * outside a render the machine is that of the workspace on screen.
 */
export function machineNodeSizes(endpointId: string = currentEndpointId()): NodeSizes {
    return serverInfoOf(endpointId).nodeSizes;
}

/* The size a new node of a kind takes: the one a person gave the kind on the machine, else the built-in one. */
export function defaultNodeSize(kind: NodeKind, endpointId?: string): NodeSize {
    return nodeSizeOf(machineNodeSizes(endpointId), kind);
}
