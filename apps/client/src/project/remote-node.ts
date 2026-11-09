import { fireAndForget } from '@/transport-api/transport';
/*
 * What making a node on another machine takes, in the order that leaves nothing half made. The
 * machine is linked to the project first, the project then has the node, and only then does the
 * other machine hear of it (`RemoteMirror`, which waits on `holdMirror` until the save has landed).
 * A refusal anywhere takes the node back out, so the canvas is as it was.
 */
export interface RemoteNodeSteps {
    /* Whether the machine already links this project to the checkout, so neither side is asked again. */
    linked: boolean;
    /* `peer.bind` on the other machine. */
    bindThere(): Promise<void>;
    /* `remote.link` on the machine the project lives on. */
    linkHere(): Promise<void>;
    /* A worktree of the checkout on the other machine, when the person asked for one; its folder is where the node works. */
    makeWorktree(): Promise<string | null>;
    addNode(cwd: string | null): string | null;
    removeNode(nodeId: string): void;
    /* Writes the project, which refuses a node that cannot run there. */
    save(): Promise<void>;
    /* Keeps the other machine from hearing of the node before the project has it; the returned function lets it. */
    holdMirror(): () => void;
}

export async function createRemoteNode(steps: RemoteNodeSteps): Promise<string> {
    if (!steps.linked) {
        await steps.bindThere();
        await steps.linkHere();
    }
    const cwd = await steps.makeWorktree();
    const release = steps.holdMirror();
    let nodeId: string | null = null;
    try {
        nodeId = steps.addNode(cwd);
        if (nodeId === null) {
            throw new Error('There is no canvas to put the node on');
        }
        await steps.save();
        return nodeId;
    } catch (e) {
        if (nodeId !== null) {
            steps.removeNode(nodeId);
            await fireAndForget('steps.save', steps.save());
        }
        throw e;
    } finally {
        release();
    }
}
