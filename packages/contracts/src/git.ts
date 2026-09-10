import { z } from 'zod';

export const WorktreeSchema = z.object({
    path: z.string(),
    branch: z.string()
});
export type Worktree = z.infer<typeof WorktreeSchema>;

// A worktree for a branch of the repository; made under the app data dir when it does not exist yet.
export const WorktreeAddPayloadSchema = z.object({
    repo: z.string().min(1),
    branch: z.string().min(1)
});
export type WorktreeAddPayload = z.infer<typeof WorktreeAddPayloadSchema>;

export const WorktreeAddResultSchema = z.object({
    worktree: WorktreeSchema,
    // False when the branch already had a worktree and that one was answered.
    created: z.boolean()
});
export type WorktreeAddResult = z.infer<typeof WorktreeAddResultSchema>;

export const WorktreeListPayloadSchema = z.object({
    repo: z.string().min(1)
});
export type WorktreeListPayload = z.infer<typeof WorktreeListPayloadSchema>;

export const WorktreeListResultSchema = z.object({
    worktrees: z.array(WorktreeSchema)
});
export type WorktreeListResult = z.infer<typeof WorktreeListResultSchema>;

export const WorktreeRemovePayloadSchema = z.object({
    repo: z.string().min(1),
    path: z.string().min(1)
});
export type WorktreeRemovePayload = z.infer<typeof WorktreeRemovePayloadSchema>;

// Which group a changed file sits in. A file that is both staged and changed since is in two.
export const GitFileStateSchema = z.enum(['staged', 'unstaged', 'untracked', 'conflicted']);
export type GitFileState = z.infer<typeof GitFileStateSchema>;

export const GitFileSchema = z.object({
    // Relative to the repository root, POSIX separators, the form every git command takes back.
    path: z.string(),
    // Where a rename came from; only a staged rename has one.
    oldPath: z.string().optional(),
    state: GitFileStateSchema,
    // The porcelain letter for this side of the file: `M`, `A`, `D`, `R`, `C`, `T`, `?` for an
    // untracked file, and the two letters of the unmerged pair for a conflict (`UU`, `AA`, `DU`).
    status: z.string(),
    added: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    binary: z.boolean()
});
export type GitFile = z.infer<typeof GitFileSchema>;

export const GitStatusSchema = z.object({
    // False when the folder is not inside a repository; everything below is then empty.
    repo: z.boolean(),
    root: z.string().nullable(),
    // Null on a detached HEAD, which `detached` says apart from a repository without commits.
    branch: z.string().nullable(),
    detached: z.boolean(),
    upstream: z.string().nullable(),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
    // The branch this work is measured against: the remote's default branch, else `main` or `master`.
    base: z.string().nullable(),
    // Where this branch left the base; null without a base or without shared history.
    mergeBase: z.string().nullable(),
    files: z.array(GitFileSchema),
    // Set when more files changed than the list carries, so a missing name is not proof of absence.
    truncated: z.boolean(),
    // False once the daemon gave up watching this repository (too slow, or too many tracked files):
    // the client then refreshes on focus and after every change of its own.
    live: z.boolean()
});
export type GitStatus = z.infer<typeof GitStatusSchema>;

// The checkout to act on: the project folder, or the worktree a bound group carries.
export const GitCwdPayloadSchema = z.object({
    cwd: z.string().min(1)
});
export type GitCwdPayload = z.infer<typeof GitCwdPayloadSchema>;

export const GitStatusEventSchema = z.object({
    cwd: z.string(),
    status: GitStatusSchema
});
export type GitStatusEvent = z.infer<typeof GitStatusEventSchema>;

// `worktree` is HEAD (or the index, with `staged`) against the file on disk, `base` is everything
// this branch holds over the base branch, uncommitted work included.
export const GitDiffScopeSchema = z.enum(['worktree', 'base']);
export type GitDiffScope = z.infer<typeof GitDiffScopeSchema>;

export const GitDiffPayloadSchema = z.object({
    cwd: z.string().min(1),
    // Relative to the repository root, as `git.status` names it.
    path: z.string().min(1),
    scope: GitDiffScopeSchema,
    // Worktree scope only: the index against HEAD instead of the working tree against the index.
    staged: z.boolean().optional(),
    // Leaves changes that are whitespace alone out of the diff, counts included.
    ignoreWhitespace: z.boolean().optional()
});
export type GitDiffPayload = z.infer<typeof GitDiffPayloadSchema>;

export const GitDiffResultSchema = z.object({
    path: z.string(),
    // The unified diff, empty when `omitted` says why there is none.
    diff: z.string(),
    added: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    binary: z.boolean(),
    omitted: z.enum(['binary', 'too-large']).optional()
});
export type GitDiffResult = z.infer<typeof GitDiffResultSchema>;

export const GitStagePayloadSchema = z.object({
    cwd: z.string().min(1),
    paths: z.array(z.string().min(1)).min(1),
    // True stages the paths, false takes them back out of the index.
    staged: z.boolean()
});
export type GitStagePayload = z.infer<typeof GitStagePayloadSchema>;

export const GitDiscardPayloadSchema = z.object({
    cwd: z.string().min(1),
    paths: z.array(z.string().min(1)).min(1)
});
export type GitDiscardPayload = z.infer<typeof GitDiscardPayloadSchema>;

export const GitDiscardResultSchema = z.object({
    // The stash the discarded work went into, so it can be taken back; null when git found
    // nothing to stash and the working tree was already what HEAD holds.
    stash: z.string().nullable()
});
export type GitDiscardResult = z.infer<typeof GitDiscardResultSchema>;
