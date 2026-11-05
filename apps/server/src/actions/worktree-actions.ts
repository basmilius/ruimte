import { ToolRefusal } from '@adecore/agents/context';
import { isWithin } from '@adecore/utils/path';
import { worktreeDiffOutput, type ActionHandlers } from '@ruimte/actions';
import { designNodeChats, isCanvasView, isChatNode, type ProjectContent, type Worktree } from '@ruimte/contracts';
import { GitError } from '../git/run.ts';
import { field, orNote, type CanvasHost, type WorktreeHost } from '../tools/host.ts';
import { hostService, type ServerActionContext } from './context.ts';

function worktreeHostOf(context: ServerActionContext): WorktreeHost {
    return hostService(context, 'worktrees', 'not-a-repository', 'This machine has no git to read worktrees with');
}

/* The worktrees of the caller's project, refusing a project outside a repository. */
async function worktreesOf(context: ServerActionContext): Promise<{ content: ProjectContent; worktrees: Worktree[] }> {
    const { host, place } = context;
    const [content, worktrees] = await Promise.all([
        host.projects.read(place.projectId),
        worktreeHostOf(context)
            .list(place.folder)
            .catch((e: unknown) => {
                if (e instanceof GitError && e.code === 'not-a-repo') {
                    throw new ToolRefusal('not-a-repository', `${place.folder} is not in a git repository`);
                }
                throw e;
            })
    ]);
    return { content, worktrees };
}

/*
 * The nodes of the project working in a worktree: the one it was made for, and every terminal or chat
 * whose folder is inside it. A design node counts when any of its chats works there, a later one too.
 */
function nodesIn(content: ProjectContent, worktree: Worktree): string[] {
    const ids = new Set<string>(worktree.nodeId === undefined ? [] : [worktree.nodeId]);
    if (worktree.missing) {
        return [...ids];
    }
    for (const view of content.views) {
        if (!isCanvasView(view)) {
            continue;
        }
        for (const node of view.nodes) {
            if (node.kind !== 'terminal' && !isChatNode(node)) {
                continue;
            }
            const folders = [node.cwd, ...designNodeChats(node).map((chat) => chat.node.cwd)];
            if (folders.some((cwd) => cwd !== undefined && isWithin(worktree.path, cwd))) {
                ids.add(node.id);
            }
        }
    }
    return [...ids];
}

function branchLines(worktrees: readonly Worktree[]): string[] {
    return orNote(
        worktrees.map((worktree) => `worktree\t${field(worktree.branch)}`),
        'This repository has no worktrees'
    );
}

function named(worktrees: readonly Worktree[], branch: string): Worktree {
    const worktree = worktrees.find((candidate) => candidate.branch === branch);
    if (!worktree) {
        throw new ToolRefusal('unknown-worktree', `${branch} is not the branch of a worktree of this repository`, branchLines(worktrees));
    }
    return worktree;
}

// Only the caller's own child: a grandchild's worktree is its own parent's to merge, as a grandchild is its parent's to read.
function openedBy(host: CanvasHost, caller: string, nodeId: string): boolean {
    return host.lineage.madeBy(nodeId) === caller;
}

export const worktreeActions: ActionHandlers<ServerActionContext> = {
    'worktree.list': async (_input, { context }) => {
        const { content, worktrees } = await worktreesOf(context);
        return {
            output: {
                worktrees: worktrees.map((worktree) => ({
                    branch: worktree.branch,
                    path: worktree.missing ? null : worktree.path,
                    nodes: nodesIn(content, worktree),
                    from: worktree.from?.branch ?? null,
                    changed: worktree.work?.changed ?? 0,
                    untracked: worktree.work?.untracked ?? 0,
                    ahead: worktree.work?.ahead ?? 0
                }))
            }
        };
    },
    'worktree.diff': async ({ branch }, { context }) => {
        const { worktrees } = await worktreesOf(context);
        const worktree = named(worktrees, branch);
        if (worktree.missing) {
            throw new ToolRefusal('worktree-missing', `The folder of ${branch} is gone, so there is nothing to diff`);
        }
        const diff = await worktreeHostOf(context).diff(worktree.path, worktree.from?.branch ?? worktree.from?.commit);
        return { output: worktreeDiffOutput(branch, worktree, diff) };
    },
    /*
     * An agent's merge only merges, under the limits the host holds it to: only the worktree of an agent
     * it opened, into a checkout without tracked changes, a conflict taken back and refused, the child
     * left running and the worktree and its branch left for a person to remove.
     */
    'worktree.merge': async ({ branch, strategy, message }, { actor, context }) => {
        // A person and Voice merge through the client, which asks them first; the daemon's rules are an agent's.
        if (actor.kind !== 'agent') {
            throw new ToolRefusal('forbidden-action', `The daemon merges a worktree only for an agent, not for the ${actor.kind} actor`);
        }
        const { host, place } = context;
        const { content, worktrees } = await worktreesOf(context);
        const worktree = named(worktrees, branch);
        const owner = worktree.nodeId;
        if (owner === undefined || !openedBy(host, actor.id, owner)) {
            throw new ToolRefusal(
                'not-yours',
                `${branch} was made for ${owner ?? 'no agent'}, and worktree merge only merges the worktree of an agent you opened`,
                [`made for\t${owner ?? '-'}`, `you\t${actor.id}`, 'person\tA person merges any worktree from the git panel']
            );
        }
        const title = content.views.flatMap((view) => (isCanvasView(view) ? view.nodes : [])).find((node) => node.id === owner)?.title ?? branch;
        const result = await worktreeHostOf(context).merge({
            repo: place.folder,
            path: worktree.path,
            strategy,
            subject: message ?? `${title}: work of the agent`
        });
        return { output: { branch, into: result.into ?? null, strategy, summary: result.summary } };
    }
};
