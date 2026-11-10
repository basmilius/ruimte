import { CodedError } from '@adecore/agents';

export type MachineOfNode = (nodeId: string) => string | null;

/*
 * A node bound to another machine has no shell or chat here. A client that does not know the binding
 * (an older release) would start one in its place, so the requests that start or show it refuse.
 */
export function refuseBoundNode(machineOf: MachineOfNode, nodeId: string): void {
    if (machineOf(nodeId) !== null) {
        throw new CodedError('node-on-other-machine', `${nodeId} runs on another machine; this one starts nothing for it`);
    }
}
