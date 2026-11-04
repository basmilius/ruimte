import type { Worktree } from '@ruimte/contracts';
import type { CheckoutHost, WorktreeHost, WorktreeWant } from '../tools/host.ts';
import { diffCheckout } from './diff.ts';
import { mergeBaseWith } from './status.ts';
import type { WorktreeMerge } from './worktree-merge.ts';
import type { Worktrees } from './worktrees.ts';

let merges = 0;

/* What the `worktree` tool reaches git through: the same register, diff and merge a person's panel uses. */
export function worktreeHost(worktrees: Worktrees, merge: WorktreeMerge): WorktreeHost {
    return {
        list: (folder) => worktrees.list(folder, { inspect: true }),
        diff: async (path, base) => diffCheckout(path, await mergeBaseWith(path, base)),
        merge: (payload) =>
            merge.merge({ ...payload, actionId: `tool-merge-${++merges}`, commitFirst: true }, () => undefined, {
                cleanTarget: true,
                abortOnConflict: true
            })
    };
}

/* What a tool that starts a node in a worktree reaches the machine's worktrees through. */
export function checkoutHost(worktrees: Worktrees): CheckoutHost {
    return {
        paths: (folder) =>
            worktrees
                .list(folder)
                .then((list) => list.map((worktree) => worktree.path))
                .catch(() => []),
        branches: (folder) => worktrees.branches(folder).catch(() => null),
        add: (folder, want, projectId) => addWanted(worktrees, folder, want, projectId),
        claim: (folder, path, nodeId) => worktrees.claim(folder, path, nodeId),
        remove: (folder, path) => worktrees.remove(folder, path)
    };
}

async function addWanted(worktrees: Worktrees, folder: string, want: WorktreeWant, projectId: string): Promise<{ worktree: Worktree; created: boolean }> {
    const options = want.base === undefined ? {} : { base: want.base };
    return 'branch' in want
        ? await worktrees.add(folder, want.branch, { madeBy: 'verb', projectId }, options)
        : { worktree: await worktrees.addFresh(folder, want.fresh, { madeBy: 'verb', projectId }, options), created: true };
}
