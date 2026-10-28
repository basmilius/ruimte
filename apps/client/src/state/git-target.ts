import type { GitRepo, Worktree } from '@ruimte/contracts';
import { shownChatOfNode } from '@/design/design-chat';
import { membersOf, type CanvasNode } from '@/state/canvas';
import { basenameOf } from '@/shell/panels/files-tree';
import { workFolderOf, worktreeOfPath } from '@/shell/panels/worktree-rows';

export interface GitTarget {
    /* The checkout every request of the panel acts on; null when no project is open. */
    cwd: string | null;
    /* What the chip says: the folder's name, or the branch of the worktree. */
    label: string;
    branch: string | null;
    kind: 'project' | 'repo' | 'worktree';
    /* The name of the group that binds this worktree, when one does. */
    group?: string;
    /* The selected node that pointed the panel at this worktree, when the selection did. */
    via?: string;
}

function boundGroupOf(nodes: Record<string, CanvasNode>, id: string): CanvasNode | null {
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
}

/*
 * Which checkout the git panel is looking at. A selected group with a worktree, a selected node that
 * sits in one, or a terminal or chat whose own folder is a worktree points the panel at that checkout;
 * everything else at the project folder. It is the rule that decides where a node made inside such a
 * group starts, so the panel and an agent in the group never look at two different trees.
 */
export function gitTarget(nodes: Record<string, CanvasNode>, selection: string[], folder: string | null, worktrees: readonly Worktree[] = []): GitTarget {
    for (const id of selection) {
        const worktree = boundGroupOf(nodes, id)?.worktree;
        if (worktree) {
            return { cwd: worktree.path, label: worktree.branch, branch: worktree.branch, kind: 'worktree', via: id };
        }
        const node = nodes[id];
        // A design points the panel where the chat it shows works.
        const own = node === undefined ? null : worktreeOfPath(worktrees, workFolderOf(node, shownChatOfNode(node) ?? node.id));
        if (own) {
            return { cwd: own.path, label: own.branch, branch: own.branch, kind: 'worktree', via: id };
        }
    }
    return { cwd: folder, label: folder === null ? '' : basenameOf(folder), branch: null, kind: 'project' };
}

/*
 * Every checkout the panel can be pointed at by hand: the repositories of the project folder first,
 * then the worktrees the daemon knows, each with the group that binds it when there is one. The order
 * is the one the daemon reports, so a menu built from this reads the same way twice. A folder whose
 * repositories are not in yet still offers itself, which is every project with exactly one.
 */
export function gitTargets(
    nodes: Record<string, CanvasNode>,
    worktrees: readonly Worktree[],
    folder: string | null,
    repos: readonly GitRepo[] = []
): GitTarget[] {
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
}

/* A checkout picked by hand, or the project folder pinned when `target` is null. `from` is where the
   selection pointed at the moment of the pick, so a selection that moves elsewhere takes over again. */
export interface GitPick {
    target: GitTarget | null;
    from: string | null;
}

export interface GitPlace {
    /* The worktree the panel is in, or null for the repositories of the project folder. */
    worktree: GitTarget | null;
    /* True while the selection put the panel in that worktree and no pick of a person outranks it. */
    following: boolean;
}

/*
 * Where the panel stands, given what the selection points at and what a person picked. A pick outranks
 * the selection until the selection points somewhere else of its own, and a picked worktree that has
 * since gone hands the panel back to the selection.
 */
export function gitPlace(derived: GitTarget, picked: GitPick | null, targets: readonly GitTarget[]): GitPlace {
    const stands = picked !== null && picked.from === derived.cwd && (picked.target === null || targets.some((entry) => entry.cwd === picked.target?.cwd));
    if (stands) {
        return { worktree: picked.target, following: false };
    }
    return derived.kind === 'worktree' ? { worktree: derived, following: true } : { worktree: null, following: false };
}
