import { z } from 'zod';

// What a worktree holds that its target branch does not: removing it without force refuses while any count is above zero.
export const WorktreeWorkSchema = z.object({
    // Tracked files changed or staged against the worktree's own HEAD.
    changed: z.number().int().nonnegative(),
    // Untracked files, one per file; ignored files are not work.
    untracked: z.number().int().nonnegative(),
    // Commits on the worktree that the branch it was made from lacks.
    ahead: z.number().int().nonnegative(),
    // A rebase, merge, cherry-pick or revert that stopped halfway, by git's own word for it; that is work too.
    operation: z.string().optional(),
    // Commits the branch it was made from gained since the worktree left it; not work, only how far behind it is.
    behind: z.number().int().nonnegative().optional()
});
export type WorktreeWork = z.infer<typeof WorktreeWorkSchema>;

export const WorktreeSchema = z.object({
    path: z.string(),
    branch: z.string(),
    // Hand-made and legacy worktrees may lack all registered metadata below.
    // Where the worktree was made from; `branch` is absent when HEAD was detached then.
    from: z.object({ branch: z.string().optional(), commit: z.string() }).optional(),
    projectId: z.string().optional(),
    nodeId: z.string().optional(),
    madeAt: z.number().optional(),
    // The folder is gone while git or the register still knows the worktree; only commits can be counted then.
    missing: z.boolean().optional(),
    // Locked with `git worktree lock`; removing it takes force.
    locked: z.boolean().optional(),
    // Only with `inspect` on the list.
    work: WorktreeWorkSchema.optional()
});
export type Worktree = z.infer<typeof WorktreeSchema>;
