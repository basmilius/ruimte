import type { WorktreeHost } from '../canvas/verb.ts';
import { diffCheckout } from './diff.ts';
import { mergeBaseWith } from './status.ts';
import type { WorktreeMerge } from './worktree-merge.ts';
import type { Worktrees } from './worktrees.ts';

let merges = 0;

/* What the `worktree` verb reaches git through: the same register, diff and merge a person's panel uses. */
export const worktreeHost = (worktrees: Worktrees, merge: WorktreeMerge): WorktreeHost => ({
    list: (folder) => worktrees.list(folder, { inspect: true }),
    diff: async (path, base) => diffCheckout(path, await mergeBaseWith(path, base)),
    merge: (payload) =>
        merge.merge({ ...payload, actionId: `verb-merge-${++merges}`, commitFirst: true }, () => undefined, {
            cleanTarget: true,
            abortOnConflict: true,
            stopIdle: true
        })
});
