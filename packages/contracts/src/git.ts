import { z } from 'zod';
import { AgentKindSchema } from './agent.ts';
import { WorktreeSchema } from '@adecore/agent-contracts/worktree';
import { BYTES_CHUNK_MAX } from './bytes.ts';
import { ChangeSplitSchema } from './change-split.ts';

// Made under the app data dir when the branch has no worktree yet.
export const WorktreeAddPayloadSchema = z.object({
    repo: z.string().min(1),
    branch: z.string().min(1),
    projectId: z.string().optional(),
    // A new branch starts here: a branch, tag or commit. Without it, at HEAD.
    base: z.string().min(1).optional()
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
    keepBranch: z.boolean().optional(),
    // Stops the agents working in the worktree first instead of refusing with `agent-working`.
    stopAgent: z.boolean().optional()
});
export type WorktreeRemovePayload = z.infer<typeof WorktreeRemovePayloadSchema>;

export const WorktreeRemoveResultSchema = z.object({
    branchDeleted: z.boolean().optional(),
    // Where the deleted branch pointed, so `git branch <name> <commit>` brings it back until git collects it.
    branchCommit: z.string().optional()
});
export type WorktreeRemoveResult = z.infer<typeof WorktreeRemoveResultSchema>;

export const GitWorktreesEventSchema = z.object({
    repo: z.string()
});
export type GitWorktreesEvent = z.infer<typeof GitWorktreesEventSchema>;

// A file that is both staged and changed since is in two groups.
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

// An operation that stopped halfway and waits in the checkout.
export const GitOperationSchema = z.enum(['merge', 'rebase', 'cherry-pick', 'revert']);
export type GitOperation = z.infer<typeof GitOperationSchema>;

// A list past this is one nobody reads, and a status that carries it is one nobody wants on the wire.
export const GIT_STATUS_MAX_FILES = 1000;

export const GitStatusSchema = z.object({
    // False when the folder is not inside a repository; everything below is then empty.
    repo: z.boolean(),
    // Set while the checkout is in the middle of one, conflicts or not.
    operation: GitOperationSchema.optional(),
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
    files: z.array(GitFileSchema).max(GIT_STATUS_MAX_FILES),
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

export const GitWatchPayloadSchema = GitCwdPayloadSchema.extend({
    // Asks for the status read once the watch is up, which spares a first read its own round trip.
    status: z.boolean().optional()
});
export type GitWatchPayload = z.infer<typeof GitWatchPayloadSchema>;

export const GitWatchResultSchema = z.object({
    // Only when asked for; a daemon from before it answers none and the client reads the status itself.
    status: GitStatusSchema.optional()
});
export type GitWatchResult = z.infer<typeof GitWatchResultSchema>;

// `nested`: a repository that happens to sit under the project folder.
export const GitRepoKindSchema = z.enum(['root', 'submodule', 'nested']);
export type GitRepoKind = z.infer<typeof GitRepoKindSchema>;

export const GitRepoSchema = z.object({
    // Absolute on the daemon's machine; every git verb takes it as its cwd.
    path: z.string(),
    // What a hidden repository is remembered under: the path under the project folder, or the folder's
    // own name for the repository the folder itself is in.
    label: z.string(),
    // What the checkout calls itself (`.idea/.name`, or the name of a Ruimte project in it), for a
    // heading that reads better than its folder. Absent when it declares none; never an identity.
    name: z.string().optional(),
    kind: GitRepoKindSchema
});
export type GitRepo = z.infer<typeof GitRepoSchema>;

export const GitReposPayloadSchema = z.object({
    folder: z.string().min(1),
    // A person's refresh: list the folder again instead of answering from the daemon's short-lived cache.
    fresh: z.boolean().optional()
});
export type GitReposPayload = z.infer<typeof GitReposPayloadSchema>;

export const GitReposResultSchema = z.object({
    // The folder's own repository first, then the rest by label.
    repos: z.array(GitRepoSchema),
    // Set when more repositories sit under the folder than the list carries.
    truncated: z.boolean()
});
export type GitReposResult = z.infer<typeof GitReposResultSchema>;

export const GitStatusEventSchema = z.object({
    cwd: z.string(),
    status: GitStatusSchema
});
export type GitStatusEvent = z.infer<typeof GitStatusEventSchema>;

// Apart from `git.status`, which only goes out when the status reads differently: a second edit to a
// modified file leaves the status alone while its diff changed.
export const GitChangedEventSchema = z.object({
    cwd: z.string(),
    // Absolute working-tree paths; absent when metadata or an unnamed event can affect any file.
    changedPaths: z.array(z.string()).optional()
});
export type GitChangedEvent = z.infer<typeof GitChangedEventSchema>;

// Scopes compare the working tree, all work over a base branch, or one commit with its parent.
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
    // Base scope starts at this ref's merge base with HEAD; omitting a path includes every file.
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
    omitted: z.enum(['binary', 'too-large']).optional(),
    // Set even when the patch is omitted.
    kind: z.enum(['add', 'update', 'delete']).optional()
});
export type GitDiffFile = z.infer<typeof GitDiffFileSchema>;

export const GitCommitSchema = z.object({
    hash: z.string(),
    shortHash: z.string(),
    subject: z.string(),
    author: z.string(),
    // Seconds since the epoch, the way git writes an author date.
    at: z.number().int(),
    // What `git log` sorts by; a rebase or an amend moves it and keeps the author date. A daemon from
    // before it leaves it out.
    committedAt: z.number().int().optional(),
    // Branch and tag names on this commit, without their `refs/` prefix.
    refs: z.array(z.string()),
    // A daemon from before these leaves them out.
    authorEmail: z.string().optional(),
    // The names in `refs` that are remote-tracking branches, such as `origin/main`.
    remoteRefs: z.array(z.string()).optional()
});
export type GitCommit = z.infer<typeof GitCommitSchema>;

export const GitDiffResultSchema = GitDiffFileSchema.extend({
    // A whole commit answers every file it touched here, with `path` left empty; one file answers
    // itself and leaves this out.
    files: z.array(GitDiffFileSchema).optional(),
    // Set when more files changed than `files` carries.
    truncated: z.boolean().optional(),
    // What the commit scope was read from, so the tab can name it without asking again.
    commit: GitCommitSchema.optional(),
    // One file in the worktree or base scope: its whole text on either side of `diff`, so a reader
    // can unfold the lines between hunks. Empty for a side the file does not exist on; both are left
    // out when a side is not text, is too large or no longer matches the patch.
    oldText: z.string().optional(),
    newText: z.string().optional()
});
export type GitDiffResult = z.infer<typeof GitDiffResultSchema>;

// For the editor's code vision. `path` is relative to the repository root and held to the checkout like a diff's.
export const GitBlamePayloadSchema = z.object({
    cwd: z.string().min(1),
    path: z.string().min(1)
});
export type GitBlamePayload = z.infer<typeof GitBlamePayloadSchema>;

export const GitBlameCommitSchema = z.object({
    hash: z.string(),
    shortHash: z.string(),
    author: z.string(),
    email: z.string(),
    // Seconds since the epoch, the author date.
    at: z.number().int(),
    summary: z.string()
});
export type GitBlameCommit = z.infer<typeof GitBlameCommitSchema>;

export const GitBlameResultSchema = z.object({
    commits: z.array(GitBlameCommitSchema),
    // One entry per line of the working tree's file: an index into `commits`, or -1 for a line no
    // commit holds yet: typed, or staged and not committed.
    lines: z.array(z.number().int()),
    // Why `lines` is empty: git has no history for the file, or it is too large to read.
    omitted: z.enum(['untracked', 'too-large']).optional()
});
export type GitBlameResult = z.infer<typeof GitBlameResultSchema>;

// Which repository a folder is a checkout of, so two machines can tell they hold the same one. A clone has the same root commits whatever its remote says.
export const GitIdentityPayloadSchema = z.object({
    paths: z.array(z.string().min(1)).max(50)
});
export type GitIdentityPayload = z.infer<typeof GitIdentityPayloadSchema>;

export const GitIdentitySchema = z.object({
    path: z.string(),
    // The commits of HEAD that have no parent.
    rootCommits: z.array(z.string()).max(50),
    // The URL of `origin` without any credentials in it; absent without that remote.
    remoteUrl: z.string().optional(),
    // Absent on a detached HEAD.
    branch: z.string().optional(),
    // HEAD first, then the tip of every local branch.
    heads: z.array(z.string()).max(50)
});
export type GitIdentity = z.infer<typeof GitIdentitySchema>;

export const GitIdentityMissSchema = z.object({
    path: z.string(),
    // `timed-out`: git did not answer for that folder in time, which is not the same as no repository there.
    error: z.enum(['not-a-repository', 'timed-out'])
});
export type GitIdentityMiss = z.infer<typeof GitIdentityMissSchema>;

export const GitIdentityResultSchema = z.object({
    // In the order of the paths asked.
    identities: z.array(z.union([GitIdentitySchema, GitIdentityMissSchema]))
});
export type GitIdentityResult = z.infer<typeof GitIdentityResultSchema>;

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
    current: z.boolean(),
    isDefault: z.boolean(),
    // The checkout that has this branch out, when another worktree does; git refuses a second one.
    worktree: z.string().optional(),
    // The commit the tip points at.
    commit: z.string().optional(),
    // Seconds since the epoch, the commit date its tip carries; the list is newest first.
    at: z.number().int()
});
export type GitRef = z.infer<typeof GitRefSchema>;

export const GitRefCommitPayloadSchema = z.object({
    cwd: z.string().min(1),
    ref: z.string().min(1)
});
export type GitRefCommitPayload = z.infer<typeof GitRefCommitPayloadSchema>;

export const GitRefCommitResultSchema = z.object({
    commit: z.string(),
    subject: z.string()
});
export type GitRefCommitResult = z.infer<typeof GitRefCommitResultSchema>;

export const GitIssuePayloadSchema = z.object({
    cwd: z.string().min(1),
    // A link, `owner/repo#12` or `#12`, which reads in the repository of the folder.
    ref: z.string().min(1)
});
export type GitIssuePayload = z.infer<typeof GitIssuePayloadSchema>;

export const GitIssueSchema = z.object({
    repo: z.string(),
    number: z.number().int().positive(),
    title: z.string(),
    body: z.string(),
    url: z.string(),
    state: z.string(),
    author: z.string().nullable(),
    labels: z.array(z.string())
});
export type GitIssue = z.infer<typeof GitIssueSchema>;

export const GitPrCheckStateSchema = z.enum(['pending', 'success', 'failure', 'neutral', 'skipped']);
export type GitPrCheckState = z.infer<typeof GitPrCheckStateSchema>;

export const GitPrCheckSchema = z.object({
    // Tells two runs of one name apart: the push run and the pull request run of a workflow are different checks.
    key: z.string(),
    name: z.string(),
    workflow: z.string().optional(),
    event: z.string().optional(),
    state: GitPrCheckStateSchema,
    url: z.string().optional()
});
export type GitPrCheck = z.infer<typeof GitPrCheckSchema>;

export const GitPrCommentSchema = z.object({
    author: z.string(),
    // A GitHub App or a login ending in [bot], such as a review bot.
    bot: z.boolean(),
    body: z.string(),
    url: z.string(),
    createdAt: z.string()
});
export type GitPrComment = z.infer<typeof GitPrCommentSchema>;

export const GitPrThreadSchema = z.object({
    id: z.string(),
    path: z.string().optional(),
    line: z.number().int().optional(),
    resolved: z.boolean(),
    outdated: z.boolean(),
    comments: z.array(GitPrCommentSchema),
    // More comments than the ones carried.
    truncated: z.boolean().optional()
});
export type GitPrThread = z.infer<typeof GitPrThreadSchema>;

export const GitPullRequestSchema = z.object({
    repo: z.string(),
    number: z.number().int().positive(),
    url: z.string(),
    title: z.string(),
    state: z.string(),
    isDraft: z.boolean(),
    // The commit the checks belong to; a different one replaces everything read before.
    headSha: z.string(),
    headBranch: z.string(),
    baseBranch: z.string(),
    mergeable: z.string(),
    mergeState: z.string(),
    reviewDecision: z.string().nullable(),
    checks: z.array(GitPrCheckSchema),
    checkState: z.enum(['pending', 'success', 'failure', 'none']),
    threads: z.array(GitPrThreadSchema),
    // GitHub's own totals for the whole pull request; a machine from before them leaves them out.
    added: z.number().int().nonnegative().optional(),
    deleted: z.number().int().nonnegative().optional(),
    changedFiles: z.number().int().nonnegative().optional()
});
export type GitPullRequest = z.infer<typeof GitPullRequestSchema>;

export const GitPullRequestPayloadSchema = z.object({
    cwd: z.string().min(1),
    // Without it, the pull request of the branch the folder is on.
    number: z.number().int().positive().optional()
});
export type GitPullRequestPayload = z.infer<typeof GitPullRequestPayloadSchema>;

export const GitPullRequestResultSchema = z.object({
    pr: GitPullRequestSchema.nullable()
});
export type GitPullRequestResult = z.infer<typeof GitPullRequestResultSchema>;

/* `git.prSplit`: the split of a pull request `git.pr` answered, read from every page of GitHub's file list, so it comes after. */
export const GitPrSplitPayloadSchema = z.object({
    cwd: z.string().min(1),
    number: z.number().int().positive(),
    // The head `git.pr` answered at; a pull request that moved since gives none, since it would disagree with those totals.
    headSha: z.string().min(1)
});
export type GitPrSplitPayload = z.infer<typeof GitPrSplitPayloadSchema>;

export const GitPrSplitResultSchema = z.object({
    // Null when GitHub's file list could not be read whole, so a split never disagrees with the totals.
    split: ChangeSplitSchema.nullable()
});
export type GitPrSplitResult = z.infer<typeof GitPrSplitResultSchema>;

// A person's watch on one pull request for one chat. The daemon polls it and wakes the chat once per finished state.
export const GitPrWatchSchema = z.object({
    id: z.string().min(1),
    projectId: z.string().min(1).max(256),
    chatId: z.string().min(1).max(256),
    cwd: z.string().min(1),
    repo: z.string(),
    number: z.number().int().positive(),
    // Epoch ms; the watch ends seven days after it.
    startedAt: z.number().int().nonnegative(),
    // The head and check state the last poll saw, for the pill's tooltip.
    head: z.string(),
    checkState: z.enum(['pending', 'success', 'failure', 'none'])
});
export type GitPrWatch = z.infer<typeof GitPrWatchSchema>;

export const GitPrWatchPayloadSchema = z.object({
    projectId: z.string().min(1).max(256),
    chatId: z.string().min(1).max(256),
    cwd: z.string().min(1),
    number: z.number().int().positive().optional()
});
export const GitPrWatchResultSchema = z.object({ watch: GitPrWatchSchema });
export const GitPrUnwatchPayloadSchema = z.object({ chatId: z.string().min(1).max(256) });
// Without a project, every watch of the machine.
export const GitPrWatchesPayloadSchema = z.object({ projectId: z.string().min(1).max(256).optional() });
export const GitPrWatchesResultSchema = z.object({ watches: z.array(GitPrWatchSchema).max(1000) });
export const GitPrWatchEndReasonSchema = z.enum(['merged', 'closed', 'expired', 'folder-missing']);
export type GitPrWatchEndReason = z.infer<typeof GitPrWatchEndReasonSchema>;
// A person's Stop carries no `ended`: only a watch that ended by itself says why, and for which chat.
export const GitPrWatchesEventSchema = z.object({
    projectId: z.string().min(1).max(256),
    ended: z.object({ chatId: z.string().min(1).max(256), reason: GitPrWatchEndReasonSchema }).optional()
});

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

/* `git.authors`: the GitHub accounts behind the addresses that wrote the repository's recent commits, as GitHub itself linked them. */
export const GitAuthorsResultSchema = z.object({
    // Empty when the repository is not on GitHub or gh cannot reach it.
    authors: z
        .array(
            z.object({
                // Lowercase, so a row matches it whatever case git wrote.
                email: z.string(),
                // The account's numeric id, which names its picture.
                id: z.number().int().positive()
            })
        )
        .max(100)
});
export type GitAuthorsResult = z.infer<typeof GitAuthorsResultSchema>;

// One request because they share a shape: progress lines while git runs, a summary line, failure output as the error.
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
    force: z.boolean().optional(),
    // Pull and sync: how a branch that has moved on both sides comes together. Without it the pull
    // only fast-forwards.
    strategy: z.enum(['merge', 'rebase']).optional(),
    // Commit: rewrite the last commit with this message and whatever is staged, which may be nothing.
    // A daemon from before it makes a new commit instead, so a client sends it only where
    // `git.capabilities` says `amend`.
    amend: z.boolean().optional()
});
export type GitActionPayload = z.infer<typeof GitActionPayloadSchema>;

export const GitActionResultSchema = z.object({
    actionId: z.string(),
    // One line for the toast: what happened, in the words a person would use.
    summary: z.string(),
    // Everything git wrote, so a failure can be copied whole.
    output: z.string(),
    commit: z.object({ hash: z.string(), subject: z.string() }).optional(),
    // The pull request a `create-pr` opened, for the button that opens it.
    url: z.string().optional(),
    // Files git left unmerged. A pull or a merge that ends here did not fail: it waits for a person,
    // and the checkout holds the operation until it is finished or taken back.
    conflicts: z.array(z.string()).optional()
});
export type GitActionResult = z.infer<typeof GitActionResultSchema>;

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

/*
 * `git.clone`: a repository from a remote into a new folder, with its progress over `git.progress` under
 * `actionId` (phase `fetch`, then `done` or `failed`) and `git.cancel` to stop it. Only a remote URL is
 * taken (HTTPS, SSH, git), never a local path; the folder must not exist yet or be empty, and its parent must.
 */
export const GitClonePayloadSchema = z.object({
    actionId: z.string().min(1),
    url: z.string().min(1).max(2048),
    path: z.string().min(1).max(4096)
});
export type GitClonePayload = z.infer<typeof GitClonePayloadSchema>;

export const GitCloneResultSchema = z.object({
    path: z.string(),
    // Everything git wrote.
    output: z.string()
});
export type GitCloneResult = z.infer<typeof GitCloneResultSchema>;

// The largest file the client copies from the ignored files of one checkout into a clone of it on another machine.
export const IGNORED_COPY_MAX_BYTES = 1024 * 1024;

export const GitIgnoredFilesPayloadSchema = z.object({ cwd: z.string().min(1) });
export type GitIgnoredFilesPayload = z.infer<typeof GitIgnoredFilesPayloadSchema>;

/*
 * `git.ignoredFiles`: the files git ignores in a checkout, a folder ignored whole (`node_modules/`) left
 * out. Paths are relative to `root`, the checkout's top level, and `prefix` is where `cwd` sits in it.
 */
export const GitIgnoredFilesResultSchema = z.object({
    root: z.string(),
    prefix: z.string(),
    files: z.array(
        z.object({
            path: z.string(),
            size: z.number(),
            // A symbolic link, which is never copied: where it points means nothing on another machine.
            link: z.boolean(),
            // The file's permission bits, which a copy keeps so a private file stays private.
            mode: z.number().int().optional()
        })
    ),
    // More files than one answer lists.
    truncated: z.boolean()
});
export type GitIgnoredFilesResult = z.infer<typeof GitIgnoredFilesResultSchema>;

export const GitCapabilitiesResultSchema = z.object({
    // Whether `gh` is on the daemon's PATH, which is what opening a pull request needs.
    gh: z.boolean(),
    // The CLI that writes a commit message here, or null on a machine without one installed.
    messageProvider: AgentKindSchema.nullable(),
    // Whether a commit takes `amend`. A daemon from before it leaves it out.
    amend: z.boolean().optional()
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

// Only `text` is weighed line by line; the rest is a choice between whole files, or a file and its absence.
export const GitConflictKindSchema = z.enum(['text', 'binary', 'deleted-by-us', 'deleted-by-them', 'submodule']);
export type GitConflictKind = z.infer<typeof GitConflictKindSchema>;

export const GitConflictFileSchema = z.object({
    path: z.string(),
    kind: GitConflictKindSchema
});
export type GitConflictFile = z.infer<typeof GitConflictFileSchema>;

// In a rebase "ours" is the branch replayed onto and "theirs" the person's own commit, the reverse of a merge.
export const GitConflictsResultSchema = z.object({
    operation: GitOperationSchema.nullable(),
    // What a person reads above each side: a branch name, a commit subject, or a plain word.
    ours: z.string(),
    theirs: z.string(),
    files: z.array(GitConflictFileSchema)
});
export type GitConflictsResult = z.infer<typeof GitConflictsResultSchema>;

export const GitConflictPayloadSchema = z.object({
    cwd: z.string().min(1),
    // Relative to the repository root, as `git.status` names it.
    path: z.string().min(1)
});
export type GitConflictPayload = z.infer<typeof GitConflictPayloadSchema>;

export const GitConflictResultSchema = z.object({
    path: z.string(),
    kind: GitConflictKindSchema,
    // The three versions git holds in its index. A side that added the file has no base, and a side
    // that deleted it has nothing at all.
    base: z.string().nullable(),
    ours: z.string().nullable(),
    theirs: z.string().nullable(),
    // What stands on disk right now, conflict markers and all, and the digest a resolution is held
    // against so a write never lands on a file that moved since it was read.
    hash: z.string(),
    // Set when a side is too large or not text to read; the file is then a choice between whole sides.
    omitted: z.enum(['binary', 'too-large']).optional()
});
export type GitConflictResult = z.infer<typeof GitConflictResultSchema>;

export const GitResolvePayloadSchema = z.object({
    cwd: z.string().min(1),
    path: z.string().min(1),
    // The merged file, written as it stands and staged. Needs `hash` to say what it was written over.
    content: z.string().optional(),
    // One side whole, for the file nobody merges line by line. `delete` takes the file out.
    take: z.enum(['ours', 'theirs', 'delete']).optional(),
    hash: z.string().optional()
});
export type GitResolvePayload = z.infer<typeof GitResolvePayloadSchema>;

export const GitResolveResultSchema = z.object({
    // Files git still holds unmerged in this checkout, so a client knows what is left without asking.
    remaining: z.number().int().nonnegative()
});
export type GitResolveResult = z.infer<typeof GitResolveResultSchema>;

// `continue` commits what was resolved and carries a rebase on; `abort` puts the checkout back as it was.
export const GitOperationPayloadSchema = z.object({
    cwd: z.string().min(1),
    actionId: z.string().min(1),
    action: z.enum(['continue', 'abort'])
});
export type GitOperationPayload = z.infer<typeof GitOperationPayloadSchema>;

/* One stretch of a conflicted file as a CLI would have it, by where it sits in the file's blocks. */
export const GitResolveBlockSchema = z.object({
    index: z.number().int().nonnegative(),
    // The digest of the two sides of that block, so a client whose split reads differently from the
    // daemon's drops the answer instead of writing it into the wrong stretch.
    fingerprint: z.string(),
    lines: z.array(z.string())
});
export type GitResolveBlock = z.infer<typeof GitResolveBlockSchema>;

export const GitResolveAiPayloadSchema = z.object({
    cwd: z.string().min(1),
    path: z.string().min(1),
    // Names the run, so `git.cancel` can stop it.
    actionId: z.string().min(1),
    // Which CLI to ask; without one the daemon takes the first installed provider that can chat.
    provider: AgentKindSchema.optional()
});
export type GitResolveAiPayload = z.infer<typeof GitResolveAiPayloadSchema>;

export const GitResolveAiResultSchema = z.object({
    blocks: z.array(GitResolveBlockSchema),
    // What the CLI could not answer for, in its own words, for the blocks it left alone.
    note: z.string().optional()
});
export type GitResolveAiResult = z.infer<typeof GitResolveAiResultSchema>;

export const WorktreeMergeStrategySchema = z.enum(['merge', 'squash', 'rebase']);
export type WorktreeMergeStrategy = z.infer<typeof WorktreeMergeStrategySchema>;

/*
 * Merges a worktree's branch into the branch it was made from, in the checkout that has that branch
 * out. Progress goes over `git.progress` under `actionId`, and `git.cancel` stops it until the merge
 * step itself starts.
 */
export const WorktreeMergePayloadSchema = z.object({
    repo: z.string().min(1),
    path: z.string().min(1),
    actionId: z.string().min(1),
    // `merge` writes a merge commit, `squash` one commit with `subject`, `rebase` puts the commits on top and fast-forwards.
    strategy: WorktreeMergeStrategySchema,
    // Commits the uncommitted and untracked files in the worktree first, under `subject`; without it such work is refused.
    commitFirst: z.boolean().optional(),
    // The message of that commit and of a squash commit.
    subject: z.string().optional(),
    body: z.string().optional(),
    // Removes the worktree and its branch once the merge went through.
    remove: z.boolean().optional(),
    // Stops the agents working in the worktree first instead of refusing while one is in a turn.
    stopAgent: z.boolean().optional(),
    // Merges into this branch instead of the one the worktree was made from.
    into: z.string().min(1).optional()
});
export type WorktreeMergePayload = z.infer<typeof WorktreeMergePayloadSchema>;

export const WorktreeMergeResultSchema = GitActionResultSchema.extend({
    // The checkout the merge ran in, where a conflict waits and `git.worktree-abort` acts.
    cwd: z.string().optional(),
    into: z.string().optional(),
    // Files that conflict; the merge waits in `cwd` for a person to resolve or abort it.
    conflicts: z.array(z.string()).optional(),
    removed: z.boolean().optional(),
    branchDeleted: z.boolean().optional(),
    // Why the worktree stayed although removing it was asked for.
    kept: z.string().optional()
});
export type WorktreeMergeResult = z.infer<typeof WorktreeMergeResultSchema>;

export { WorktreeSchema, WorktreeWorkSchema, type Worktree, type WorktreeWork } from '@adecore/agent-contracts/worktree';

/*
 * A checkout's state as a git bundle in this machine's bundle folder, for another machine to read with
 * `bytes.read`. `files` is the working tree as it is, uncommitted and untracked files included, as a
 * commit on HEAD; `head` is HEAD's tree the same way; `branch` is the branch as it stands. Nothing in
 * the checkout changes.
 */
export const GitBundlePayloadSchema = z.object({
    path: z.string().min(1),
    from: z.enum(['files', 'head', 'branch']),
    // Required for `branch`.
    branch: z.string().min(1).optional(),
    // Commits the receiving machine has; whatever they reach is left out of the bundle. Those this checkout lacks are ignored.
    haves: z.array(z.string().min(1).max(64)).max(200),
    // The subject of the handoff commit.
    name: z.string().min(1).max(120)
});
export type GitBundlePayload = z.infer<typeof GitBundlePayloadSchema>;

export const GitBundleResultSchema = z.object({
    bundleId: z.string().min(1).max(64),
    size: z.number().int().nonnegative(),
    sha256: z.string().length(64),
    // The tip of the bundle.
    commit: z.string().min(1),
    // The commit it builds on, null for the first commit of a repository.
    base: z.string().nullable(),
    // The checkout lies in a folder this machine never vouched for (work another machine sent), which the machine that takes it in keeps to.
    untrusted: z.boolean().optional()
});
export type GitBundleResult = z.infer<typeof GitBundleResultSchema>;

// A piece of a bundle on its way in; the pieces come in order and `offset` is where this one starts.
export const GitBundlePutPayloadSchema = z.object({
    bundleId: z.string().min(1).max(64),
    offset: z.number().int().nonnegative(),
    data: z.string().max(Math.ceil((BYTES_CHUNK_MAX * 4) / 3) + 4),
    // The size of the whole bundle, which is how this machine tells an upload that is done from one still open.
    total: z.number().int().positive().optional()
});
export type GitBundlePutPayload = z.infer<typeof GitBundlePutPayloadSchema>;

export const GitBundlePutResultSchema = z.object({ received: z.number().int().nonnegative() });
export type GitBundlePutResult = z.infer<typeof GitBundlePutResultSchema>;

/*
 * Takes a bundle that came in with `git.bundlePut` into a project's repository. `worktree` makes a
 * worktree on a new branch `ruimte/<branch>`. `remote-ref` keeps the tip as `ruimte-<machine>/<branch>`
 * among the remote branches and makes a worktree on it, the way back from another machine.
 */
export const GitFetchBundlePayloadSchema = z.object({
    projectId: z.string().min(1),
    bundleId: z.string().min(1).max(64),
    sha256: z.string().length(64),
    branch: z.string().min(1).max(200),
    into: z.enum(['worktree', 'remote-ref']),
    // What the other machine is called, for the remote the branch is listed under.
    machine: z.string().min(1).max(120).optional(),
    // The machine it came from did not vouch for it (`untrusted` on its bundle), so neither does this one. It can only narrow.
    untrusted: z.boolean().optional()
});
export type GitFetchBundlePayload = z.infer<typeof GitFetchBundlePayloadSchema>;

export const GitFetchBundleResultSchema = z.object({
    path: z.string().optional(),
    branch: z.string(),
    commit: z.string()
});
export type GitFetchBundleResult = z.infer<typeof GitFetchBundleResultSchema>;
