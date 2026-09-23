import type { ActionHandlers } from '@ruimte/actions';
import { isCanvasView, type ProjectContent, type Worktree } from '@ruimte/contracts';
import { isInside } from '../canvas/project-paths.ts';
import { VerbRefusal, field, orNote, type CanvasHost, type WorktreeHost } from '../canvas/verb.ts';
import { GitError } from '../git/run.ts';
import type { IndexedPlace } from '../projects/project-index.ts';
import type { ServerActionContext } from './context.ts';

// How far up the chain of openers a merge looks for the caller; a chain this deep is refused by `agent` long before.
const MAX_LINEAGE = 64;

const worktreeHostOf = (host: CanvasHost): WorktreeHost => {
    if (host.worktrees === undefined) {
        throw new VerbRefusal('not-a-repository', 'This machine has no git to read worktrees with');
    }
    return host.worktrees;
};

/* The worktrees of the caller's project, refusing a project outside a repository. */
const worktreesOf = async (host: CanvasHost, place: IndexedPlace): Promise<{ content: ProjectContent; worktrees: Worktree[] }> => {
    const [content, worktrees] = await Promise.all([
        host.read(place.projectId),
        worktreeHostOf(host)
            .list(place.folder)
            .catch((e: unknown) => {
                if (e instanceof GitError && e.code === 'not-a-repo') {
                    throw new VerbRefusal('not-a-repository', `${place.folder} is not in a git repository`);
                }
                throw e;
            })
    ]);
    return { content, worktrees };
};

/* The nodes of the project working in a worktree: the one it was made for, and every terminal or chat whose folder is inside it. */
const nodesIn = (content: ProjectContent, worktree: Worktree): string[] => {
    const ids = new Set<string>(worktree.nodeId === undefined ? [] : [worktree.nodeId]);
    for (const view of content.views) {
        if (!isCanvasView(view)) {
            continue;
        }
        for (const node of view.nodes) {
            if ((node.kind === 'terminal' || node.kind === 'chat') && node.cwd !== undefined && !worktree.missing && isInside(worktree.path, node.cwd)) {
                ids.add(node.id);
            }
        }
    }
    return [...ids];
};

const branchLines = (worktrees: readonly Worktree[]): string[] =>
    orNote(
        worktrees.map((worktree) => `worktree\t${field(worktree.branch)}`),
        'This repository has no worktrees'
    );

const named = (worktrees: readonly Worktree[], branch: string): Worktree => {
    const worktree = worktrees.find((candidate) => candidate.branch === branch);
    if (!worktree) {
        throw new VerbRefusal('unknown-worktree', `${branch} is not the branch of a worktree of this repository`, branchLines(worktrees));
    }
    return worktree;
};

/* Whether the caller opened this node, or opened the agent that did, however far down. */
const openedBy = (host: CanvasHost, caller: string, nodeId: string): boolean => {
    let current: string | null = nodeId;
    for (let i = 0; i < MAX_LINEAGE && current !== null; i++) {
        current = host.madeBy(current);
        if (current === caller) {
            return true;
        }
    }
    return false;
};

export const worktreeActions: ActionHandlers<ServerActionContext> = {
    'worktree.list': async (_input, { context }) => {
        const { content, worktrees } = await worktreesOf(context.host, context.place);
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
        const { worktrees } = await worktreesOf(context.host, context.place);
        const worktree = named(worktrees, branch);
        if (worktree.missing) {
            throw new VerbRefusal('worktree-missing', `The folder of ${branch} is gone, so there is nothing to diff`);
        }
        const diff = await worktreeHostOf(context.host).diff(worktree.path, worktree.from?.branch ?? worktree.from?.commit);
        return {
            output: {
                branch,
                from: worktree.from?.branch ?? null,
                files: (diff.files ?? []).map((file) => ({
                    path: file.path,
                    added: file.added,
                    deleted: file.deleted,
                    diff: file.diff,
                    omitted: file.omitted ?? null
                }))
            }
        };
    },
    /*
     * An agent's merge only merges, under the limits the host holds it to: only the worktree of an agent
     * it opened, into a checkout without tracked changes, a conflict taken back and refused, the child
     * left running and the worktree and its branch left for a person to remove.
     */
    'worktree.merge': async ({ branch, strategy, message }, { actor, context }) => {
        const { host, place } = context;
        const { content, worktrees } = await worktreesOf(host, place);
        const worktree = named(worktrees, branch);
        const owner = worktree.nodeId;
        if (owner === undefined || !openedBy(host, actor.id, owner)) {
            throw new VerbRefusal(
                'not-yours',
                `${branch} was made for ${owner ?? 'no agent'}, and worktree merge only merges the worktree of an agent you opened`,
                [`made for\t${owner ?? '-'}`, `you\t${actor.id}`, 'person\tA person merges any worktree from the git panel']
            );
        }
        const title = content.views.flatMap((view) => (isCanvasView(view) ? view.nodes : [])).find((node) => node.id === owner)?.title ?? branch;
        const result = await worktreeHostOf(host).merge({
            repo: place.folder,
            path: worktree.path,
            strategy,
            subject: message ?? `${title}: work of the agent`
        });
        return { output: { branch, into: result.into ?? null, strategy, summary: result.summary } };
    }
};
