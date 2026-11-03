import { VerbRefusal, type CanvasHost } from './verb.ts';

/*
 * A line on this machine never reaches a node that runs on another one: what it would read or
 * operate here is an empty shell the node left behind, not the node.
 */
export function refuseOtherMachine(host: Pick<CanvasHost, 'projects'>, nodeId: string): void {
    if (host.projects.machineOfNode(nodeId) !== null) {
        throw new VerbRefusal('node-on-other-machine', `${nodeId} runs on another machine, and nothing on this one reads or operates it`);
    }
}
