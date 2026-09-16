import { z } from 'zod';
import { AgentKindSchema } from './agent.ts';

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
    // Everything below comes from the daemon's register and from inspecting the checkout, so a worktree
    // made by hand or by an older daemon has none of it.
    // Where the worktree was made from; `branch` is absent when HEAD was detached then.
    from: z.object({ branch: z.string().optional(), commit: z.string() }).optional(),
    projectId: z.string().optional(),
    // The node it was made for.
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

// A worktree for a branch of the repository; made under the app data dir when it does not exist yet.
export const WorktreeAddPayloadSchema = z.object({
    repo: z.string().min(1),
    branch: z.string().min(1),
    // The project the person made it in, kept in the register.
    projectId: z.string().optional()
});
export type WorktreeAddPayload = z.infer<typeof WorktreeAddPayloadSchema>;

export const WorktreeAddResultSchema = z.object({
    worktree: WorktreeSchema,
    // False when the branch already had a worktree and that one was answered.
    created: z.boolean()
});
export type WorktreeAddResult = z.infer<typeof WorktreeAddResultSchema>;

export const WorktreeListPayloadSchema = z.object({
    repo: z.string().min(1),
    // Counts the work in every worktree, which costs a few git calls each.
    inspect: z.boolean().optional()
});
export type WorktreeListPayload = z.infer<typeof WorktreeListPayloadSchema>;

export const WorktreeListResultSchema = z.object({
    worktrees: z.array(WorktreeSchema)
});
export type WorktreeListResult = z.infer<typeof WorktreeListResultSchema>;

export const WorktreeRemovePayloadSchema = z.object({
    repo: z.string().min(1),
    path: z.string().min(1),
    // Removes a worktree that holds work, and deletes its branch with commits the target lacks.
    force: z.boolean().optional(),
    // True keeps the branch; false deletes a branch the register does not know as well.
    keepBranch: z.boolean().optional()
});
export type WorktreeRemovePayload = z.infer<typeof WorktreeRemovePayloadSchema>;

export const WorktreeRemoveResultSchema = z.object({
    branchDeleted: z.boolean().optional(),
    // Where the deleted branch pointed, so `git branch <name> <commit>` brings it back until git collects it.
    branchCommit: z.string().optional()
});
export type WorktreeRemoveResult = z.infer<typeof WorktreeRemoveResultSchema>;

// The worktrees of this repository changed; a client that lists them asks again.
export const GitWorktreesEventSchema = z.object({
    repo: z.string()
});
export type GitWorktreesEvent = z.infer<typeof GitWorktreesEventSchema>;

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
// this branch holds over the base branch, uncommitted work included, and `commit` is one commit
// against the one before it.
export const GitDiffScopeSchema = z.enum(['worktree', 'base', 'commit']);
export type GitDiffScope = z.infer<typeof GitDiffScopeSchema>;

export const GitDiffPayloadSchema = z.object({
    cwd: z.string().min(1),
    // Relative to the repository root, as `git.status` names it. Left out in the `commit` scope the
    // answer carries every file of the commit instead of one.
    path: z.string().min(1).optional(),
    scope: GitDiffScopeSchema,
    // The commit the `commit` scope reads, as any name git resolves.
    commit: z.string().min(1).optional(),
    // Worktree scope only: the index against HEAD instead of the working tree against the index.
    staged: z.boolean().optional(),
    // Leaves changes that are whitespace alone out of the diff, counts included.
    ignoreWhitespace: z.boolean().optional(),
    // Base scope only: the ref the diff starts from, through its merge base with HEAD, instead of the
    // repository's base branch; a worktree passes the branch it was made from. Without a path the
    // base scope answers every file of the checkout in `files`, untracked ones included.
    base: z.string().min(1).optional()
});
export type GitDiffPayload = z.infer<typeof GitDiffPayloadSchema>;

export const GitDiffFileSchema = z.object({
    path: z.string(),
    // The unified diff, empty when `omitted` says why there is none.
    diff: z.string(),
    added: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    binary: z.boolean(),
    omitted: z.enum(['binary', 'too-large']).optional()
});
export type GitDiffFile = z.infer<typeof GitDiffFileSchema>;

// One commit as a log row: what it is, who wrote it and the names pointing at it.
export const GitCommitSchema = z.object({
    hash: z.string(),
    shortHash: z.string(),
    subject: z.string(),
    author: z.string(),
    // Seconds since the epoch, the way git writes an author date.
    at: z.number().int(),
    // Branch and tag names on this commit, without their `refs/` prefix.
    refs: z.array(z.string())
});
export type GitCommit = z.infer<typeof GitCommitSchema>;

export const GitDiffResultSchema = GitDiffFileSchema.extend({
    // A whole commit answers every file it touched here, with `path` left empty; one file answers
    // itself and leaves this out.
    files: z.array(GitDiffFileSchema).optional(),
    // Set when more files changed than `files` carries.
    truncated: z.boolean().optional(),
    // What the commit scope was read from, so the tab can name it without asking again.
    commit: GitCommitSchema.optional()
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

export const GitRefSchema = z.object({
    // `main` for a local branch, `origin/main` for a remote one, as git itself shortens them.
    name: z.string(),
    kind: z.enum(['local', 'remote']),
    // Whether HEAD is on this branch right now.
    current: z.boolean(),
    // The base branch of the repository, so a menu can mark it.
    isDefault: z.boolean(),
    // The checkout that has this branch out, when another worktree does; git refuses a second one.
    worktree: z.string().optional(),
    // Seconds since the epoch, the commit date its tip carries; the list is newest first.
    at: z.number().int()
});
export type GitRef = z.infer<typeof GitRefSchema>;

// One entry of `git stash list`: the ref that pops it and the line it was saved under.
export const GitStashSchema = z.object({
    ref: z.string(),
    message: z.string()
});
export type GitStash = z.infer<typeof GitStashSchema>;

export const GitRefsResultSchema = z.object({
    refs: z.array(GitRefSchema),
    current: z.string().nullable(),
    // Newest first, the order `stash@{0}` counts in.
    stashes: z.array(GitStashSchema)
});
export type GitRefsResult = z.infer<typeof GitRefsResultSchema>;

export const GitLogPayloadSchema = z.object({
    cwd: z.string().min(1),
    limit: z.number().int().positive().max(200).optional(),
    // What a previous answer handed back; opaque to the client, it names where the next page starts.
    cursor: z.string().optional()
});
export type GitLogPayload = z.infer<typeof GitLogPayloadSchema>;

export const GitLogResultSchema = z.object({
    commits: z.array(GitCommitSchema),
    // Null when this page was the last one.
    cursor: z.string().nullable()
});
export type GitLogResult = z.infer<typeof GitLogResultSchema>;

/*
 * Everything the panel can do to a checkout, as one request. They are one kind and not one request
 * each because they share a shape: a stream of progress lines while git runs, one summary line when
 * it is over, and the output of a failure as the error.
 */
export const GitActionKindSchema = z.enum([
    'fetch',
    'pull',
    'push',
    'publish',
    'force-push',
    'sync',
    'checkout',
    'create-branch',
    'rename-branch',
    'delete-branch',
    'merge',
    'rebase',
    'stash',
    'stash-pop',
    'commit',
    'commit-push',
    'create-pr'
]);
export type GitActionKind = z.infer<typeof GitActionKindSchema>;

export const GitActionPayloadSchema = z.object({
    cwd: z.string().min(1),
    // The client names its own action, so the progress of one it started is the progress it draws.
    actionId: z.string().min(1),
    kind: GitActionKindSchema,
    // The branch to check out, merge, rebase onto, delete, or branch from; the stash to pop.
    ref: z.string().min(1).optional(),
    // The name a branch is created or renamed with.
    name: z.string().min(1).optional(),
    // A commit's subject line, a stash's message, a pull request's title.
    subject: z.string().optional(),
    // The rest of a commit message or a pull request's body.
    body: z.string().optional(),
    // Commit: put every changed file in the index first.
    stageAll: z.boolean().optional(),
    // Checkout: park the dirty working tree in a stash first, so the switch is not refused.
    stash: z.boolean().optional(),
    // Delete a branch git has not merged yet, which it otherwise refuses.
    force: z.boolean().optional()
});
export type GitActionPayload = z.infer<typeof GitActionPayloadSchema>;

export const GitActionResultSchema = z.object({
    actionId: z.string(),
    // One line for the toast: what happened, in the words a person would use.
    summary: z.string(),
    // Everything git wrote, so a failure can be copied whole.
    output: z.string(),
    // The commit a commit action wrote.
    commit: z.object({ hash: z.string(), subject: z.string() }).optional(),
    // The pull request a `create-pr` opened, for the button that opens it.
    url: z.string().optional()
});
export type GitActionResult = z.infer<typeof GitActionResultSchema>;

// Where an action is: the step it is on, `done` when the last one is over, `failed` when git said no.
export const GitActionPhaseSchema = z.enum(['start', 'fetch', 'stage', 'commit', 'push', 'pull', 'branch', 'stash', 'merge', 'rebase', 'pr', 'done', 'failed']);
export type GitActionPhase = z.infer<typeof GitActionPhaseSchema>;

export const GitProgressEventSchema = z.object({
    cwd: z.string(),
    actionId: z.string(),
    phase: GitActionPhaseSchema,
    // One line git wrote, or the empty string for a phase that only says where the action is.
    line: z.string()
});
export type GitProgressEvent = z.infer<typeof GitProgressEventSchema>;

export const GitCancelPayloadSchema = z.object({
    actionId: z.string().min(1)
});
export type GitCancelPayload = z.infer<typeof GitCancelPayloadSchema>;

export const GitCapabilitiesResultSchema = z.object({
    // Whether `gh` is on the daemon's PATH, which is what opening a pull request needs.
    gh: z.boolean(),
    // The CLI that writes a commit message here, or null on a machine without one installed.
    messageProvider: AgentKindSchema.nullable()
});
export type GitCapabilitiesResult = z.infer<typeof GitCapabilitiesResultSchema>;

export const GitSuggestMessagePayloadSchema = z.object({
    cwd: z.string().min(1),
    // Names the run, so `git.cancel` can stop it.
    actionId: z.string().min(1),
    // Which CLI to ask; without one the daemon takes the first installed provider that can chat.
    provider: AgentKindSchema.optional()
});
export type GitSuggestMessagePayload = z.infer<typeof GitSuggestMessagePayloadSchema>;

export const GitSuggestMessageResultSchema = z.object({
    subject: z.string(),
    body: z.string()
});
export type GitSuggestMessageResult = z.infer<typeof GitSuggestMessageResultSchema>;
