import {
    ChatVisualSchema,
    DatabaseAgentAccessSchema,
    TEMPLATE_LANGUAGES,
    TEMPLATE_LIMITS,
    TEMPLATE_PLACES,
    LaunchConfigEntrySchema,
    LaunchConfigKindSchema,
    LaunchStateSchema,
    RoutineEntrySchema,
    SECRET_LIMITS,
    SECRET_VARIABLE_PATTERN,
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
    PERSON_AND_VOICE,
    AGENT,
    PERSON,
    databaseConnection,
    databaseSchema,
    languagePath,
    languageLine,
    languageColumn,
    languageSpan,
    languageType,
    languageHead,
    DATABASE_QUERY_ROWS,
    DATABASE_QUERY_MAX_ROWS,
    nodeId,
    revision,
    forActors,
    PERSON_VOICE_AND_AGENT,
    PERSON_AND_AGENT,
    routineId,
    optionalFields,
    launchName,
    launchStarted,
    launchFields,
    launchFieldName,
    launchRunFields,
    launchSaved,
    routineFields,
    routineSaved,
    routineTitle,
    routineSchedule,
    routineRunFields,
    routineNamed,
    worktreeBranch,
    repository,
    anyRepository,
    gitRun,
    gitPaths,
    gitBranch,
    gitRunOutput,
    gitRunsOutput,
    pullStrategy,
    AGENT_AND_EXTENSION
} from './fields.ts';

export const DEVELOPER_ACTIONS = {
    'operation.cancel': {
        title: 'Cancel an operation',
        description:
            'Stops an operation of your own that still runs: a git run, or the turns an agent or team start set going. Nothing is rolled back; each line says what is left.',
        agentDescription:
            'Stops the turns an agent or team you started is working on. The chats and their tasks stay, a terminal agent is left running, and nothing is rolled back; each line says what is left.',
        effect: 'shared',
        domain: 'developer',
        actors: PERSON_VOICE_AND_AGENT,
        input: z.object({
            operationId: z
                .string()
                .min(1)
                .nullable()
                .describe('git:<run> for a git run, agent.start:<id> or team.start:<id>,<id> for a start; null for every git run of yours still going')
        }),
        output: z.object({
            operations: z.array(z.object({ operationId: z.string(), status: z.enum(['cancelled', 'over', 'left']), detail: z.string() }))
        })
    },
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
    },
    'launch.save': {
        title: 'Save launches',
        description: 'Saves every launch of a project at once, against the revision it was read at; the save approves on this machine what it adds or changes.',
        effect: 'shared',
        domain: 'developer',
        // Saving approves, which is a person's alone; an agent adds and edits through launch.create and launch.edit, which approve nothing.
        actors: PERSON,
        input: z.object({
            projectId: z.string().min(1),
            baseRev: revision,
            launches: z.array(LaunchConfigEntrySchema),
            imported: z.array(z.string().min(1)).describe('The launches an import added in this save, which it leaves unapproved')
        }),
        output: z.object({ rev: z.number().int() })
    },
    'launch.list': {
        title: 'List launches',
        description: 'Lists the launches of the project with what runs of each on this machine and whether a person approved it here.',
        agentDescription: 'Lists the launches of the project: id, name, kind, state, approved, port, url',
        effect: 'read',
        domain: 'developer',
        actors: AGENT_AND_EXTENSION,
        input: z.object({}),
        output: z.object({
            launches: z.array(
                z.object({
                    launchId: z.string(),
                    name: z.string(),
                    kind: LaunchConfigKindSchema,
                    // Null for one that has not run since the machine started, and for a group, whose members each have one.
                    state: LaunchStateSchema.nullable(),
                    exitCode: z.number().int().nullable(),
                    approved: z.boolean(),
                    port: z.number().int().nullable(),
                    url: z.string().nullable(),
                    // The launches a group starts; empty for any other kind.
                    members: z.array(z.string())
                })
            )
        })
    },
    'launch.read': {
        title: 'Read a launch',
        description: 'Prints the output of a launch, whole or its last lines, as its terminal shows it now.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT_AND_EXTENSION,
        input: z.object({
            launch: launchName,
            tail: z.number().int().min(1).nullable().describe('Only the last this many lines; without it the whole output')
        }),
        // Null when it has not run since the machine started.
        output: z.object({ launchId: z.string(), name: z.string(), text: z.string().nullable() })
    },
    'launch.create': {
        title: 'Add a launch',
        description:
            'Adds a launch to the project: a service, a task or a group of launches. It never starts until a person approves it on this machine as it stands.',
        effect: 'shared',
        domain: 'developer',
        // An agent's launch is never approved by its save; a person approves it from the launch chip.
        actors: AGENT,
        input: z.object({
            name: launchFieldName,
            kind: LaunchConfigKindSchema.describe('service runs until stopped, task runs once and ends, group starts other launches'),
            ...optionalFields(launchRunFields),
            shared: z.boolean().optional().describe("Puts it in the project's shared file, which a team commits; this person's own file when omitted")
        }),
        output: launchSaved
    },
    'launch.edit': {
        title: 'Change a launch',
        description: 'Changes fields of a launch of the project; a change to what it runs waits on a person to approve it again before it starts.',
        effect: 'shared',
        domain: 'developer',
        actors: AGENT,
        input: z.object({ launch: launchName, ...optionalFields(launchFields) }),
        output: launchSaved
    },
    'launch.start': {
        title: 'Start a launch',
        description: 'Starts a launch a person approved on this machine as it stands now; one that already runs is left running.',
        effect: 'external',
        domain: 'developer',
        actors: AGENT_AND_EXTENSION,
        input: z.object({ launch: launchName }),
        output: launchStarted
    },
    'launch.restart': {
        title: 'Restart a launch',
        description: 'Stops a launch a person approved on this machine and starts it again, or starts it when it did not run.',
        effect: 'external',
        domain: 'developer',
        actors: AGENT_AND_EXTENSION,
        input: z.object({ launch: launchName }),
        output: launchStarted
    },
    'launch.stop': {
        title: 'Stop a launch',
        description: 'Stops a launch, or every launch of a group, with Ctrl+C and SIGTERM after a grace period; only a person kills one.',
        effect: 'external',
        domain: 'developer',
        actors: AGENT_AND_EXTENSION,
        input: z.object({ launch: launchName }),
        // How many of its launches ran and are being stopped.
        output: z.object({ launchId: z.string(), name: z.string(), stopping: z.number().int() })
    },
    'routine.list': {
        title: 'List routines',
        description: 'Lists the routines of the project: what each runs and when, whether a person approved it here, whether it is paused, and its last run.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT_AND_EXTENSION,
        input: z.object({}),
        output: z.object({ routines: z.array(RoutineEntrySchema), timeZone: z.string() })
    },
    'routine.create': {
        title: 'Add a routine',
        description:
            'Adds a routine to the project that starts an agent, a command or a launch at a set time; it never runs until a person approves it on this machine as it stands.',
        effect: 'shared',
        domain: 'developer',
        // An agent's save never approves; a person saves and approves through Routines in the app.
        actors: AGENT,
        input: z.object({
            title: routineTitle,
            schedule: routineSchedule,
            ...optionalFields(routineRunFields),
            shared: z.boolean().optional().describe("Puts it in the project's shared file, which a team commits; this person's own file when omitted")
        }),
        output: routineSaved
    },
    'routine.edit': {
        title: 'Change a routine',
        description: 'Changes fields of a routine of the project; a change that touches what it runs or when waits on a person to approve it again.',
        effect: 'shared',
        domain: 'developer',
        actors: AGENT,
        input: z.object({ routineId, ...optionalFields(routineFields) }),
        output: routineSaved
    },
    'routine.pause': {
        title: 'Pause a routine',
        description: 'Pauses a routine on this machine, so it starts nothing until it is resumed.',
        effect: 'local',
        domain: 'developer',
        actors: AGENT_AND_EXTENSION,
        input: z.object({ routineId }),
        output: routineNamed
    },
    'routine.resume': {
        title: 'Resume a routine',
        description: 'Resumes a paused routine from its next time on; the times it was paused through do not run.',
        effect: 'local',
        domain: 'developer',
        actors: AGENT_AND_EXTENSION,
        input: z.object({ routineId }),
        output: routineNamed
    },
    'routine.run': {
        title: 'Run a routine now',
        description: 'Starts a run of a routine now, only when a person approved it on this machine as it stands and its previous run has ended.',
        effect: 'external',
        domain: 'developer',
        actors: AGENT_AND_EXTENSION,
        input: z.object({ routineId }),
        output: routineNamed.extend({ runId: z.string() })
    },
    'secret.request': {
        title: 'Ask for a secret',
        description:
            "Asks the person, in a private card of the caller's chat, for the value of a variable of a launch; the value stays on this machine and only that launch's process gets it.",
        effect: 'external',
        domain: 'developer',
        actors: AGENT,
        input: z.object({
            launch: launchName,
            variable: z
                .string()
                .regex(SECRET_VARIABLE_PATTERN, 'A variable is letters, digits and underscores, not starting with a digit')
                .max(SECRET_LIMITS.variable)
                .describe('The environment variable of the launch the secret is bound to'),
            label: z.string().trim().min(1).max(SECRET_LIMITS.label).describe('What the person is asked for, such as the name of a service and its key'),
            reason: z.string().trim().min(1).max(SECRET_LIMITS.reason).describe('Why the launch needs it, in one or two sentences'),
            placeholder: z.string().trim().min(1).max(SECRET_LIMITS.placeholder).nullish().describe('A hint inside the field, such as the shape of the key'),
            wait: z
                .number()
                .int()
                .min(1)
                .max(110)
                .nullish()
                .describe('Seconds the call holds for the answer; 6 without it. A card that still waits after that is answered by asking again')
        }),
        // Never the value: only what became of the card, and on saved the variable now bound.
        output: z.object({
            requestId: z.string(),
            outcome: z.enum(['saved', 'declined', 'cancelled', 'timed-out', 'waiting']),
            launchId: z.string(),
            name: z.string(),
            variable: z.string()
        })
    },
    /* The machine checks the request whole, so this passes it on unparsed and a grid that pages parses nothing twice. */
    'database.request': {
        title: 'Ask a database',
        description:
            'Sends one request of the database views to the machine of this project: a table, a page of rows, a query or a change a person made in a view, and its answer.',
        effect: 'external',
        domain: 'developer',
        actors: PERSON,
        input: z.object({ request: z.unknown().describe('A request of the database views, as they made it') }),
        output: z.object({ response: z.unknown() })
    },
    'database.list': {
        title: 'List database connections',
        description: 'Lists the database connections of the project, where each points and what agents may do with it; never a password.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({}),
        output: z.object({
            connections: z.array(
                z.object({
                    id: z.string(),
                    name: z.string(),
                    engine: z.string(),
                    target: z.string(),
                    access: DatabaseAgentAccessSchema,
                    outsideProject: z.boolean()
                })
            )
        })
    },
    'database.tables': {
        title: 'List database tables',
        description: 'Lists the schemas of a database connection and the tables and views of one of them, with the row count the server estimates.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({
            connection: databaseConnection,
            schema: databaseSchema.describe("The schema whose tables to list; without it the connection's own database, or every schema when it has none")
        }),
        output: z.object({
            connection: z.string(),
            schemas: z.array(z.string()),
            tables: z.array(z.object({ schema: z.string(), name: z.string(), kind: z.string(), rowEstimate: z.number().nullable() }))
        })
    },
    'database.describe': {
        title: 'Describe a database table',
        description: 'Describes a table or view of a database connection: its columns, primary key, indexes and foreign keys.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({
            connection: databaseConnection,
            table: z.string().min(1).describe('The table or view, by name'),
            schema: databaseSchema.describe("The schema the table is in; without it the connection's own database")
        }),
        output: z.object({
            schema: z.string(),
            name: z.string(),
            kind: z.string(),
            columns: z.array(
                z.looseObject({
                    name: z.string(),
                    type: z.string(),
                    nullable: z.boolean(),
                    defaultValue: z.string().nullable(),
                    autoIncrement: z.boolean(),
                    generated: z.boolean()
                })
            ),
            primaryKey: z.array(z.string()),
            indexes: z.array(z.looseObject({ name: z.string(), columns: z.array(z.string()), unique: z.boolean(), primary: z.boolean() })),
            foreignKeys: z.array(
                z.looseObject({
                    name: z.string().nullable(),
                    columns: z.array(z.string()),
                    referencedSchema: z.string(),
                    referencedTable: z.string(),
                    referencedColumns: z.array(z.string()),
                    onUpdate: z.string().nullable(),
                    onDelete: z.string().nullable()
                })
            )
        })
    },
    /* A query that shows its rows publishes a visual the way `visual.show` does, under the same rules. */
    'database.query': {
        title: 'Query a database',
        description: 'Runs one statement that reads (SELECT or WITH) on a read-only session of a database connection and answers its first rows.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({
            connection: databaseConnection,
            sql: z.string().min(1).describe('One statement that starts with SELECT or WITH'),
            schema: databaseSchema.describe("The schema the statement runs in; without it the connection's own database"),
            limit: z.number().int().min(1).max(DATABASE_QUERY_MAX_ROWS).nullable().describe(`How many rows at most; ${DATABASE_QUERY_ROWS} without it`),
            show: z.string().nullable().describe('Also shows the rows as a table above your reply in this chat, under this title')
        }),
        output: z.object({
            connection: z.string(),
            schema: z.string().nullable(),
            columns: z.array(z.object({ name: z.string(), type: z.string(), kind: z.string() })),
            rows: z.array(z.array(z.unknown())),
            hasMore: z.boolean(),
            elapsedMs: z.number(),
            // What became of `show`: the visual, or why the table was not shown; null without `show`.
            shown: z.union([z.object({ visual: ChatVisualSchema }), z.object({ reason: z.string() })]).nullable()
        })
    },
    'database.execute': {
        title: 'Write to a database',
        description:
            'Runs one or more statements on a database connection a person allowed agents to write to, and answers what each did; never in the supervised mode.',
        effect: 'external',
        domain: 'developer',
        actors: AGENT,
        input: z.object({
            connection: databaseConnection,
            sql: z.string().min(1).describe('The statements, separated by semicolons'),
            schema: databaseSchema.describe("The schema the statements run in; without it the connection's own database")
        }),
        output: z.object({
            connection: z.string(),
            results: z.array(z.looseObject({ kind: z.enum(['rows', 'done', 'error']), sql: z.string(), elapsedMs: z.number() })),
            inTransaction: z.boolean()
        })
    },
    'language.diagnostics': {
        title: 'Read the problems of a file',
        description:
            "Reads what the project's language servers find in one file: errors, warnings, information and hints, each with where it sits and which server found it.",
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({ path: languagePath }),
        output: z.object({
            ...languageHead,
            diagnostics: z.array(
                languageSpan.extend({
                    severity: z.enum(['error', 'warning', 'information', 'hint']),
                    server: z.string(),
                    source: z.string().nullable(),
                    code: z.string().nullable(),
                    message: z.string()
                })
            )
        })
    },
    'language.hover': {
        title: 'Read what a name in a file is',
        description: "Reads what the project's language servers say of the name at a place in a file: its type, signature and documentation.",
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({ path: languagePath, line: languageLine, column: languageColumn }),
        output: z.object({ ...languageHead, contents: z.string().nullable() })
    },
    'language.definition': {
        title: 'Find where a name is defined',
        description: 'Finds where the name at a place in a file is defined, as the language servers of the project know it.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({ path: languagePath, line: languageLine, column: languageColumn }),
        output: z.object({ ...languageHead, locations: z.array(languageSpan) })
    },
    'language.references': {
        title: 'Find where a name is used',
        description: 'Finds every place the name at a place in a file is used, its definition included, as the language servers of the project know it.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({ path: languagePath, line: languageLine, column: languageColumn }),
        output: z.object({ ...languageHead, locations: z.array(languageSpan) })
    },
    'language.symbols': {
        title: 'List the symbols of a file',
        description: 'Lists what a file defines, such as classes, functions, tables and columns, nested as the language servers of the project see them.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({ path: languagePath }),
        output: z.object({
            ...languageHead,
            symbols: z.array(
                z.object({
                    name: z.string(),
                    kind: z.string(),
                    detail: z.string().nullable(),
                    depth: z.number().int(),
                    line: z.number().int(),
                    column: z.number().int(),
                    endLine: z.number().int(),
                    endColumn: z.number().int()
                })
            )
        })
    },
    'language.problems': {
        title: 'Read the problems of the whole project',
        description:
            "Reads what the last whole-project check of the project's running language servers found in every file, also files nobody has open. It starts no check; a person does from the Problems panel.",
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({
            path: languagePath.nullable().describe('A file whose servers are started first; without it only servers already running are read')
        }),
        output: z.object({
            servers: z.array(z.object({ kind: z.string(), process: z.string() })),
            files: z.number().int(),
            diagnostics: z.array(
                languageSpan.extend({
                    severity: z.enum(['error', 'warning', 'information', 'hint']),
                    server: z.string(),
                    source: z.string().nullable(),
                    code: z.string().nullable(),
                    message: z.string()
                })
            ),
            truncated: z.boolean(),
            withheld: z.number().int(),
            pulled: z.boolean().optional().describe('False while no whole-project pull ran yet, which only a person starts')
        })
    },
    'language.supertypes': {
        title: 'Find the supertypes of a type',
        description: 'Finds what the type at a place in a file extends or implements, as the language servers of the project know it.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({ path: languagePath, line: languageLine, column: languageColumn }),
        output: z.object({ ...languageHead, type: languageType.nullable(), types: z.array(languageType) })
    },
    'language.subtypes': {
        title: 'Find the subtypes of a type',
        description: 'Finds the types that extend or implement the type at a place in a file, as the language servers of the project know it.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({ path: languagePath, line: languageLine, column: languageColumn }),
        output: z.object({ ...languageHead, type: languageType.nullable(), types: z.array(languageType) })
    },
    'language.sql': {
        title: 'Read what a SQL file is read against',
        description:
            'Reads which database connection, database and schema snapshot a .sql file of the project is read against, and the command that checks it from a shell.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({ path: languagePath }),
        output: z.object({
            path: z.string(),
            source: z.enum(['file', 'console', 'default', 'none', 'unbound']),
            connection: z.object({ id: z.string(), name: z.string(), engine: z.string() }).nullable(),
            database: z.string().nullable(),
            dialect: z.string().nullable(),
            version: z.string().nullable(),
            snapshot: z.string().nullable(),
            takenAt: z.string().nullable(),
            command: z.string(),
            installed: z.boolean()
        })
    },
    'template.list': {
        title: 'List the editor templates',
        description:
            'Lists the live and postfix templates the editor expands in this project: the built-in ones that are switched on, the ones of the person and the ones the project shares. A built-in template has no body here.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({ language: z.enum(TEMPLATE_LANGUAGES).nullish().describe('Only the templates that apply to this language family') }),
        output: z.object({
            templates: z.array(
                z.object({
                    id: z.string(),
                    kind: z.enum(['live', 'postfix']),
                    key: z.string(),
                    languages: z.array(z.string()),
                    source: z.enum(['built-in', 'personal', 'project']),
                    description: z.string().nullable(),
                    body: z.string().nullable()
                })
            )
        })
    },
    'template.add': {
        title: 'Add an editor template',
        description:
            "Adds a new template to the person's own set, marked as added by an agent. It never changes or removes a template, never writes the project's file, and refuses a key that an enabled template for one of the same languages already has.",
        effect: 'local',
        domain: 'developer',
        actors: AGENT,
        input: z.object({
            kind: z.enum(['live', 'postfix']).describe('A live template expands on Tab after its key; a postfix template wraps the expression before a dot'),
            key: z
                .string()
                .min(1)
                .max(TEMPLATE_LIMITS.key)
                .describe('What the person types; a live key has no whitespace, a postfix key holds letters, digits, _ and $'),
            body: z
                .string()
                .min(1)
                .max(TEMPLATE_LIMITS.body)
                .describe('The text in snippet syntax: $0 and ${1:name} are stops, and $EXPR is the expression of a postfix template'),
            languages: z
                .array(z.enum(TEMPLATE_LANGUAGES))
                .min(1)
                .describe('The language families it applies to; a postfix template takes javascript, typescript and php only'),
            description: z.string().max(TEMPLATE_LIMITS.description).nullish().describe('One line shown beside the template in the list'),
            places: z.array(z.enum(TEMPLATE_PLACES)).nullish().describe('Where a live template applies; code without it'),
            expression: z.enum(['any', 'statement']).nullish().describe('What a postfix template wraps; any without it')
        }),
        output: z.object({ id: z.string(), kind: z.enum(['live', 'postfix']), key: z.string() })
    }
} as const;
