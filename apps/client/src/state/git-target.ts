import { membersOf, type CanvasNode } from '@/state/canvas';
import { basenameOf } from '@/shell/panels/files-tree';

export interface GitTarget {
    /* The checkout every request of the panel acts on; null for a canvas without a folder. */
    cwd: string | null;
    /* What the chip says: the folder's name, or the branch of the worktree. */
    label: string;
    branch: string | null;
    kind: 'project' | 'worktree';
}

const boundGroupOf = (nodes: Record<string, CanvasNode>, id: string): CanvasNode | null => {
    const node = nodes[id];
    if (!node) {
        return null;
    }
    if (node.kind === 'group' && node.worktree) {
        return node;
    }
    for (const group of Object.values(nodes)) {
        if (group.kind === 'group' && group.worktree && membersOf(group, nodes, {}).includes(id)) {
            return group;
        }
    }
    return null;
};

/*
 * Which checkout the git panel is looking at. A selected group with a worktree, or a selected node
 * that sits in one, points the panel at that checkout; everything else points it at the project
 * folder. It is the same rule that decides where a node made inside such a group starts, so what
 * the panel shows and what an agent in the group works on are never two different trees.
 */
export const gitTarget = (nodes: Record<string, CanvasNode>, selection: string[], folder: string | null): GitTarget => {
    for (const id of selection) {
        const worktree = boundGroupOf(nodes, id)?.worktree;
        if (worktree) {
            return { cwd: worktree.path, label: worktree.branch, branch: worktree.branch, kind: 'worktree' };
        }
    }
    return { cwd: folder, label: folder === null ? '' : basenameOf(folder), branch: null, kind: 'project' };
};
