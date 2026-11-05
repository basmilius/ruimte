import { isWithin } from '@adecore/utils/path';
import type { Worktree } from '@ruimte/contracts';
import { realOrNull } from '../fs/real-path.ts';
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
        paths: (folder) => madeWorktreePaths(worktrees, folder).catch(() => []),
        branches: (folder) => worktrees.branches(folder).catch(() => null),
        add: (folder, want, projectId) => addWanted(worktrees, folder, want, projectId),
        claim: (folder, path, nodeId) => worktrees.claim(folder, path, nodeId),
        remove: (folder, path) => worktrees.remove(folder, path)
    };
}

/*
 * The worktrees git lists that sit under the machine's worktree folder or that the daemon made, the rule a
 * save follows (`fs/write.ts`). Git takes a worktree's path from `.git/worktrees/<id>/gitdir`, a plain file in
 * the project, so a path only git names could point anywhere.
 */
async function madeWorktreePaths(worktrees: Worktrees, folder: string): Promise<string[]> {
    const [listed, registered, root] = await Promise.all([
        worktrees.list(folder),
        worktrees.registeredPaths(folder).catch(() => [] as string[]),
        realOrNull(worktrees.root)
    ]);
    const made = new Set(await Promise.all(registered.map(realOrNull)));
    const kept = await Promise.all(
        listed.map(async ({ path }) => {
            const real = await realOrNull(path);

            return real !== null && ((root !== null && isWithin(root, real)) || made.has(real)) ? path : null;
        })
    );

    return kept.filter((path) => path !== null);
}

async function addWanted(worktrees: Worktrees, folder: string, want: WorktreeWant, projectId: string): Promise<{ worktree: Worktree; created: boolean }> {
    const options = want.base === undefined ? {} : { base: want.base };
    return 'branch' in want
        ? await worktrees.add(folder, want.branch, { madeBy: 'verb', projectId }, options)
        : { worktree: await worktrees.addFresh(folder, want.fresh, { madeBy: 'verb', projectId }, options), created: true };
}
