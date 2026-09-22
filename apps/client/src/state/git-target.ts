import type { GitRepo, Worktree } from '@ruimte/contracts';
import { membersOf, type CanvasNode } from '@/state/canvas';
import { basenameOf } from '@/shell/panels/files-tree';
import { worktreeOfPath } from '@/shell/panels/worktree-rows';

export interface GitTarget {
    /* The checkout every request of the panel acts on; null when no project is open. */
    cwd: string | null;
    /* What the chip says: the folder's name, or the branch of the worktree. */
    label: string;
    branch: string | null;
    kind: 'project' | 'repo' | 'worktree';
    /* The name of the group that binds this worktree, when one does. */
    group?: string;
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
 * Which checkout the git panel is looking at. A selected group with a worktree, a selected node
 * that sits in one, or a terminal or chat whose own folder is a worktree, points the panel at that checkout; everything else points it at the project
 * folder. It is the same rule that decides where a node made inside such a group starts, so what
 * the panel shows and what an agent in the group works on are never two different trees.
 */
export const gitTarget = (nodes: Record<string, CanvasNode>, selection: string[], folder: string | null, worktrees: readonly Worktree[] = []): GitTarget => {
    for (const id of selection) {
        const worktree = boundGroupOf(nodes, id)?.worktree;
        if (worktree) {
            return { cwd: worktree.path, label: worktree.branch, branch: worktree.branch, kind: 'worktree' };
        }
        const node = nodes[id];
        const own = node?.kind === 'terminal' || node?.kind === 'chat' ? worktreeOfPath(worktrees, node.cwd) : null;
        if (own) {
            return { cwd: own.path, label: own.branch, branch: own.branch, kind: 'worktree' };
        }
    }
    return { cwd: folder, label: folder === null ? '' : basenameOf(folder), branch: null, kind: 'project' };
};

/*
 * Every checkout the panel can be pointed at by hand: the repositories of the project folder first,
 * then the worktrees the daemon knows, each with the group that binds it when there is one. The order
 * is the one the daemon reports, so a menu built from this reads the same way twice. A folder whose
 * repositories are not in yet still offers itself, which is every project with exactly one.
 */
export const gitTargets = (
    nodes: Record<string, CanvasNode>,
    worktrees: readonly Worktree[],
    folder: string | null,
    repos: readonly GitRepo[] = []
): GitTarget[] => {
    const targets: GitTarget[] =
        repos.length > 0
            ? repos.map((repo) => ({
                  cwd: repo.path,
                  label: repo.label,
                  branch: null,
                  // `project` is the folder being the only checkout there is; anything else is named.
                  kind: repos.length === 1 && repo.path === folder ? 'project' : 'repo'
              }))
            : folder === null
              ? []
              : [{ cwd: folder, label: basenameOf(folder), branch: null, kind: 'project' }];
    for (const worktree of worktrees) {
        if (worktree.missing) {
            continue;
        }
        const group = Object.values(nodes).find((node) => node.kind === 'group' && node.worktree?.path === worktree.path);
        targets.push({
            cwd: worktree.path,
            label: worktree.branch,
            branch: worktree.branch,
            kind: 'worktree',
            ...(group ? { group: group.title } : {})
        });
    }
    return targets;
};
