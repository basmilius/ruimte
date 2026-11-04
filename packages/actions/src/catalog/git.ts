import {
    GitConflictResultSchema,
    GitConflictsResultSchema,
    GitDiffResultSchema,
    GitDiffScopeSchema,
    GitLogResultSchema,
    GitRefsResultSchema,
    GitRepoKindSchema,
    GitResolveAiResultSchema,
    GitResolveResultSchema,
    GitStatusSchema,
    WorktreeSchema
} from '@ruimte/contracts';
import { z } from 'zod';
import {
    nodeId,
    forActors,
    PERSON_AND_VOICE,
    PERSON_VOICE_AND_AGENT,
    PERSON,
    PERSON_AND_AGENT,
    worktreeBranch,
    repository,
    anyRepository,
    gitRun,
    gitPaths,
    gitBranch,
    gitRunOutput,
    gitRunsOutput,
    pullStrategy
} from './fields.ts';

export const GIT_ACTIONS = {
    'git.status': {
        title: 'Read git status',
        description:
            'Reads the repositories of the project with the branch each is on, its upstream, how far ahead and behind it is, an operation that waits halfway, and the changed files: staged, unstaged, untracked or conflicted.',
        effect: 'read',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({ repository: anyRepository }),
        output: z.object({
            repositories: z.array(
                z.object({
                    repository: z.string(),
                    path: z.string(),
                    kind: z.enum([...GitRepoKindSchema.options, 'worktree']),
                    // Null when this one could not be read; `error` says why.
                    status: GitStatusSchema.nullable(),
                    error: z.string().nullable()
                })
            )
        })
    },
    'git.diff': {
        title: 'Read a git diff',
        description:
            'Reads a unified diff: one file of the working tree (staged or not), all work over a base branch, or one commit with every file it touched.',
        effect: 'read',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({
            repository,
            path: z.string().min(1).nullable().describe('One file relative to the repository root; null for every file, which the commit and base scopes take'),
            scope: GitDiffScopeSchema.describe('worktree for uncommitted changes, base for all work over the base branch, commit for one commit'),
            commit: z.string().min(1).nullable().describe('The commit the commit scope reads'),
            staged: z.boolean().nullable().describe('In the worktree scope: the index against HEAD instead of the working tree against the index'),
            ignoreWhitespace: z.boolean().nullable().describe('Leaves changes that are only whitespace out'),
            base: z.string().min(1).nullable().describe('The base scope starts at this branch instead of the repository base')
        }),
        output: GitDiffResultSchema
    },
    'git.log': {
        title: 'Read git history',
        description: 'Reads the commits of a repository, newest first, a page at a time.',
        effect: 'read',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({
            repository,
            limit: z.number().int().min(1).max(200).nullable().describe('Commits per page; 20 without it'),
            cursor: z.string().min(1).nullable().describe('Where the next page starts, as the previous answer gave it')
        }),
        output: GitLogResultSchema
    },
    'git.refs': {
        title: 'Read git branches',
        description: 'Reads the local and remote branches of a repository, which one it is on, and its stashes.',
        effect: 'read',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({ repository }),
        output: GitRefsResultSchema
    },
    'git.conflicts': {
        title: 'Read git conflicts',
        description:
            'Reads the merge, rebase, cherry-pick or revert that waits halfway in a repository, what its two sides are called, and every file it left unmerged.',
        effect: 'read',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({ repository }),
        output: GitConflictsResultSchema
    },
    'git.conflict': {
        title: 'Read a conflicted file',
        description: 'Reads the three versions git holds of one unmerged file (base, ours and theirs) and the digest a resolution is written over.',
        effect: 'read',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({ repository, path: z.string().min(1).describe('The unmerged file relative to the repository root') }),
        output: GitConflictResultSchema
    },
    'git.stage': {
        title: 'Stage files',
        description: 'Puts files in the index, so the next commit takes them.',
        effect: 'shared',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({ repository, paths: gitPaths }),
        output: z.object({ repository: z.string(), paths: z.array(z.string()) })
    },
    'git.unstage': {
        title: 'Unstage files',
        description: 'Takes files back out of the index; their changes stay in the working tree.',
        effect: 'shared',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({ repository, paths: gitPaths }),
        output: z.object({ repository: z.string(), paths: z.array(z.string()) })
    },
    'git.discard': {
        title: 'Discard changes',
        description: 'Throws away the changes to files after confirmation, parking them in a stash that brings them back.',
        effect: 'shared',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({ repository, paths: gitPaths }),
        // Null when git found nothing to stash and the files were already what HEAD holds.
        output: z.object({ repository: z.string(), paths: z.array(z.string()), stash: z.string().nullable() })
    },
    'git.suggestCommitMessage': {
        title: 'Write a commit message',
        description: 'Asks an agent CLI on the machine for a commit message from the staged diff. It commits nothing.',
        effect: 'read',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({ repository: anyRepository.describe('The repository; null for the one repository with something staged'), run: gitRun }),
        output: z.object({ repository: z.string(), subject: z.string(), body: z.string() })
    },
    'git.commit': {
        title: 'Commit',
        description:
            'Commits what is staged after confirmation, one commit per repository with the same message. With nothing staged anywhere and one repository changed, that repository is staged whole first. Push true pushes each commit after.',
        effect: 'shared',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({
            repository: anyRepository.describe('One repository; null for every repository with something staged'),
            message: z.string().trim().min(1).describe('The subject line of the commit'),
            body: z.string().nullable().describe('The rest of the message'),
            push: z.boolean().nullable().describe('Pushes the commit after'),
            stageAll: forActors(PERSON, z.boolean()).describe('Stages every changed file of the repository first'),
            run: gitRun,
            amend: forActors(PERSON, z.boolean()).describe('Rewrites the last commit of the one named repository instead of making a new one')
        }),
        output: gitRunsOutput
    },
    'git.fetch': {
        title: 'Fetch',
        description: 'Fetches from the remotes; no branch or file changes.',
        effect: 'external',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({ repository: anyRepository, run: gitRun }),
        output: gitRunsOutput
    },
    'git.pull': {
        title: 'Pull',
        description:
            'Pulls the upstream into the branch after confirmation. It only fast-forwards: a branch that moved on both sides is refused as diverged, and only the user decides in the app how it comes together.',
        effect: 'external',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({ repository: anyRepository, strategy: pullStrategy, run: gitRun }),
        output: gitRunsOutput
    },
    'git.push': {
        title: 'Push',
        description: 'Pushes the commits of a branch to its upstream after confirmation. A branch without an upstream is published with git.publishBranch.',
        effect: 'external',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({
            repository: anyRepository,
            // It rewrites history others may have pulled.
            force: forActors(PERSON, z.boolean()).describe(
                'Overwrites the remote branch with the local one, in one named repository; refused when the upstream moved since the last fetch'
            ),
            run: gitRun
        }),
        output: gitRunsOutput
    },
    'git.sync': {
        title: 'Sync',
        description: 'Pulls and then pushes after confirmation, with the same rule as a pull for a branch that moved on both sides.',
        effect: 'external',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({ repository: anyRepository, strategy: pullStrategy, run: gitRun }),
        output: gitRunsOutput
    },
    'git.publishBranch': {
        title: 'Publish branch',
        description: 'Pushes the branch the repository is on to the remote for the first time and sets it as its upstream, after confirmation.',
        effect: 'external',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({ repository, run: gitRun }),
        output: gitRunOutput
    },
    'git.checkout': {
        title: 'Switch branch',
        description:
            'Switches the repository to a branch. A tree with changes asks for confirmation first and parks them in a stash, which git.popStash brings back.',
        effect: 'shared',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({
            repository,
            branch: gitBranch,
            stashFirst: forActors(PERSON, z.boolean()).describe('Parks the changes in a stash first, so the switch is not refused'),
            run: gitRun
        }),
        output: gitRunOutput
    },
    'git.createBranch': {
        title: 'Create branch',
        description: 'Creates a branch from where the repository is and switches to it.',
        effect: 'shared',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({ repository, name: z.string().trim().min(1).describe('The name of the new branch'), run: gitRun }),
        output: gitRunOutput
    },
    'git.renameBranch': {
        title: 'Rename branch',
        description: 'Renames the branch the repository is on.',
        effect: 'shared',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({ repository, name: z.string().trim().min(1).describe('The new name of the branch'), run: gitRun }),
        output: gitRunOutput
    },
    'git.deleteBranch': {
        title: 'Delete branch',
        description: 'Deletes a local branch after confirmation. Git refuses one it has not merged.',
        effect: 'shared',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({
            repository,
            branch: gitBranch,
            // Loses commits no other branch has.
            force: forActors(PERSON, z.boolean()).describe('Deletes a branch git has not merged'),
            run: gitRun
        }),
        output: gitRunOutput
    },
    'git.merge': {
        title: 'Merge branch',
        description: 'Merges a branch into the one the repository is on, after confirmation. Conflicts stop it halfway for the user to resolve in the app.',
        effect: 'shared',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({ repository, branch: gitBranch, run: gitRun }),
        output: gitRunOutput
    },
    'git.rebase': {
        title: 'Rebase',
        description:
            'Puts the commits of the branch the repository is on on top of another branch, after confirmation. Conflicts stop it halfway for the user to resolve in the app.',
        effect: 'shared',
        domain: 'developer',
        // It rewrites the commits of the branch.
        actors: PERSON,
        input: z.object({ repository, onto: gitBranch, run: gitRun }),
        output: gitRunOutput
    },
    'git.stash': {
        title: 'Stash changes',
        description: 'Parks the changes of the working tree in a stash under a message; git.popStash brings them back.',
        effect: 'shared',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({ repository, message: z.string().trim().min(1).nullable().describe('What the stash is called'), run: gitRun }),
        output: gitRunOutput
    },
    'git.popStash': {
        title: 'Pop stash',
        description: 'Applies a stash to the working tree after confirmation and drops it once it applied. It can conflict.',
        effect: 'shared',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({ repository, stash: z.string().min(1).describe('The stash as git.refs lists it, such as stash@{0}'), run: gitRun }),
        output: gitRunOutput
    },
    'git.createPullRequest': {
        title: 'Create pull request',
        description: 'Publishes the branch when needed and opens a pull request with a title and body, after confirmation. Needs gh on the machine.',
        effect: 'external',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({
            repository,
            title: z.string().trim().min(1).describe('The title of the pull request'),
            body: z.string().nullable().describe('The description of the pull request'),
            run: gitRun
        }),
        output: gitRunOutput
    },
    'git.proposeResolution': {
        title: 'Propose a conflict resolution',
        description:
            'Asks an agent CLI on the machine how the conflicting stretches of one file come together. It writes nothing: the answer is an edit in the conflict view.',
        effect: 'read',
        domain: 'developer',
        // The proposal lands as an edit a person reviews in the conflict view; there is nowhere else for it to go.
        actors: PERSON,
        input: z.object({ repository, path: z.string().min(1), run: gitRun }),
        output: GitResolveAiResultSchema
    },
    'git.resolveConflict': {
        title: 'Resolve a conflicted file',
        description: 'Writes the merged file over the digest it was read at, or takes one side whole or the file out, and stages it.',
        effect: 'shared',
        domain: 'developer',
        // Only a person accepts a resolution.
        actors: PERSON,
        input: z.object({
            repository,
            path: z.string().min(1),
            content: z.string().nullable().describe('The merged file; needs hash'),
            take: z.enum(['ours', 'theirs', 'delete']).nullable().describe('One side whole, or the file taken out'),
            hash: z.string().nullable().describe('The digest git.conflict read the file at, empty for a file that was not on disk')
        }),
        output: GitResolveResultSchema
    },
    'git.operation': {
        title: 'Finish or take back a merge',
        description:
            'Takes back the merge, rebase, cherry-pick or revert that waits halfway in a repository, after confirmation, and puts the checkout back as it was.',
        effect: 'shared',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({
            repository,
            // Finishing commits what was resolved, and only a person accepts a resolution.
            step: z.union([z.enum(['abort']), z.enum(['continue']).meta({ actors: [...PERSON] })]).describe('abort takes the operation back'),
            run: gitRun
        }),
        output: gitRunOutput
    },
    'worktree.list': {
        title: 'List worktrees',
        description:
            'Lists the worktrees of the project repository: the branch, the path, the nodes working in it, the branch it was made from and the work it holds.',
        agentDescription: 'Lists the worktrees of the repository: branch, path, nodes, from, changed, new, commits',
        effect: 'read',
        domain: 'developer',
        actors: PERSON_VOICE_AND_AGENT,
        input: z.object({}),
        output: z.object({
            worktrees: z.array(
                z.object({
                    branch: z.string(),
                    // Null when the folder is gone.
                    path: z.string().nullable(),
                    nodes: z.array(nodeId),
                    // The branch it was made from; null for one made outside Ruimte.
                    from: z.string().nullable(),
                    changed: z.number().int(),
                    untracked: z.number().int(),
                    ahead: z.number().int()
                })
            )
        })
    },
    'worktree.diff': {
        title: 'Read what a worktree changed',
        description: 'Reads what a worktree changed since the branch it was made from, uncommitted and new files included',
        agentDescription: 'Prints what a worktree changed since the branch it was made from, uncommitted and new files included',
        effect: 'read',
        domain: 'developer',
        actors: PERSON_VOICE_AND_AGENT,
        input: z.object({ branch: worktreeBranch }),
        output: z.object({
            branch: z.string(),
            from: z.string().nullable(),
            files: z.array(
                z.object({
                    path: z.string(),
                    added: z.number().int(),
                    deleted: z.number().int(),
                    // Empty when omitted says why there is none.
                    diff: z.string(),
                    omitted: z.enum(['binary', 'too-large']).nullable()
                })
            )
        })
    },
    'worktree.create': {
        title: 'Create a worktree',
        description: 'Makes a git worktree of the project repository on a branch, after confirmation, or answers the one that branch already has.',
        effect: 'shared',
        domain: 'developer',
        actors: PERSON_AND_VOICE,
        input: z.object({
            branch: z.string().trim().min(1).describe('The branch of the worktree; made when it does not exist'),
            base: forActors(PERSON, z.string().trim().min(1)).describe('The branch, tag or commit a new branch starts at instead of HEAD')
        }),
        // False when the branch already had a worktree and that one was answered.
        output: z.object({ worktree: WorktreeSchema, created: z.boolean() })
    },
    'worktree.merge': {
        title: 'Merge a worktree',
        description:
            'Merges a worktree into the branch it was made from after confirmation, committing its uncommitted files first. Conflicts stop it halfway for the user to resolve in the app; the worktree stays.',
        agentDescription: 'Merges the worktree of an agent you opened into the branch it was made from; the worktree and its branch stay',
        effect: 'shared',
        domain: 'developer',
        actors: PERSON_VOICE_AND_AGENT,
        input: z.object({
            branch: worktreeBranch,
            // Putting the commits on top rewrites them, which Voice leaves to a person.
            strategy: z
                .union([z.enum(['merge', 'squash']), z.enum(['rebase']).meta({ actors: [...PERSON_AND_AGENT] })])
                .describe('A merge commit, one squashed commit, or the commits put on top of the target'),
            message: z
                .string()
                .trim()
                .min(1)
                .nullable()
                .describe('The message of the commit made of uncommitted files, and of a squash; without it the title of the node'),
            body: forActors(PERSON, z.string()).describe('The rest of that message'),
            commitFirst: forActors(PERSON, z.boolean()).describe(
                'Commits the uncommitted and new files of the worktree first; without it such work is refused'
            ),
            // Nothing removes a worktree on its own, and Voice is not a person's hand there.
            remove: forActors(PERSON, z.boolean()).describe('Removes the worktree and its branch once the merge went through'),
            stopAgent: forActors(PERSON, z.boolean()).describe('Stops the agents working in the worktree first instead of refusing'),
            into: forActors(PERSON, z.string().min(1)).describe('Merges into this branch instead of the one the worktree was made from'),
            run: gitRun
        }),
        output: z.object({
            branch: z.string(),
            into: z.string().nullable(),
            strategy: z.enum(['merge', 'squash', 'rebase']),
            summary: z.string(),
            // What only the client's merge answers; the daemon's own merge refuses a conflict instead.
            output: z.string().optional(),
            cwd: z.string().optional(),
            conflicts: z.array(z.string()).optional(),
            removed: z.boolean().optional(),
            branchDeleted: z.boolean().optional(),
            kept: z.string().optional()
        })
    },
    'worktree.remove': {
        title: 'Remove a worktree',
        description: 'Removes a worktree and its branch; one that holds work is refused without force.',
        effect: 'shared',
        domain: 'developer',
        // Nothing removes a worktree on its own, and Voice is not a person's hand there.
        actors: PERSON,
        input: z.object({
            branch: worktreeBranch,
            force: forActors(PERSON, z.boolean()).describe('Removes a worktree that holds work, and a branch with commits the target lacks'),
            stopAgent: forActors(PERSON, z.boolean()).describe('Stops the agents working in the worktree first instead of refusing')
        }),
        // Where a deleted branch pointed, so git branch <name> <commit> brings it back until git collects it.
        output: z.object({ branch: z.string(), branchDeleted: z.boolean().nullable(), branchCommit: z.string().nullable() })
    }
} as const;
