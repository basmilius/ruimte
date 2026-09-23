import { ActionRefusal, type ActionCall, type ActionHandlers, type ActionOutput } from '@ruimte/actions';
import {
    isCanvasView,
    type GitActionKind,
    type GitActionPayload,
    type GitActionResult,
    type GitRepo,
    type GitRepoKind,
    type GitStatus,
    type RequestMap,
    type RequestType,
    type Worktree
} from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { basenameOf } from '@/shell/panels/files-tree';
import { commitTargets, nextActionId } from '@/shell/panels/git-actions';
import { nodesInWorktree } from '@/shell/panels/worktree-rows';
import type { DocumentState } from '@/state/document';
import { useGit } from '@/state/git';
import { soleRepo, visibleRepos } from '@/state/git-repos';
import { useProject } from '@/state/project';
import { windowWorkspace } from '@/state/window';
import { TransportError, type Transport } from '@/transport/transport';

type Requester = Pick<Transport, 'request'>;

/* What the git actions reach outside the document; a test hands in a fake of each. */
export interface DeveloperMachine {
    transport(): Requester | null;
    folder(): string | null;
    projectId(): string | null;
    /* The repositories a person hid from the panel, by label; "every repository" leaves them out too. */
    hiddenRepos(): readonly string[];
    runId(): string;
}

const LIVE_MACHINE: DeveloperMachine = {
    transport: () => windowWorkspace()?.connection.transport ?? null,
    folder: () => useProject.getState().current?.folder ?? null,
    projectId: () => useProject.getState().current?.projectId ?? null,
    hiddenRepos: () => useGit.getState().hiddenRepos,
    runId: nextActionId
};

interface Checkout {
    path: string;
    label: string;
}

type GitRun = ActionOutput<'git.publishBranch'>;
type GitRuns = ActionOutput<'git.push'>;
type Call = ActionCall<void> & { confirmed: boolean };

/* A person's own dialogs already asked; everyone else answers the action's question first. */
const asksFirst = (call: Call): boolean => !call.confirmed && call.actor.kind !== 'person';

const isAbsolutePath = (value: string): boolean => /^(\/|[A-Za-z]:[\\/])/.test(value);

/* What the panel calls a checkout: its path under the project folder, or its own name when it sits elsewhere. */
const labelOf = (folder: string, path: string): string => (path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : basenameOf(path));

const listed = (items: readonly string[]): string => (items.length === 1 ? items[0]! : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

const quoted = (items: readonly string[]): string => (items.length === 0 ? 'none' : listed(items.map((item) => `“${item}”`)));

const plural = (count: number, noun: string): string => `${count} ${count === 1 ? noun : `${noun}s`}`;

const runOutput = (checkout: Checkout, result: GitActionResult): GitRun => ({
    repository: checkout.label,
    path: checkout.path,
    summary: result.summary,
    output: result.output,
    commit: result.commit ?? null,
    url: result.url ?? null,
    conflicts: result.conflicts ?? []
});

/* The daemon's refusal keeps its code, so a caller can still tell a diverged branch from a failure. */
const asRefusal = (error: unknown): unknown => (error instanceof TransportError ? new ActionRefusal(error.code, error.message) : error);

/* Where a branch stands in words: which one, and the remote it goes to. */
const branchOf = (status: GitStatus): string => status.branch ?? 'a detached HEAD';

const remoteOf = (status: GitStatus): string => status.upstream ?? `origin as a new upstream for ${branchOf(status)}`;

const changedFiles = (status: GitStatus, staged: boolean): string[] =>
    status.files.filter((file) => (staged ? file.state === 'staged' : true)).map((file) => file.path);

/* A file list for a question: every name up to a handful, then how many more. */
const filesLine = (paths: readonly string[]): string => {
    const shown = paths.slice(0, 8);
    const more = paths.length - shown.length;
    return more > 0 ? `${shown.join(', ')} and ${plural(more, 'more file')}` : listed(shown);
};

/*
 * The git panel, the branch menu, the commit box, the conflict view and the worktree dialogs as
 * actions. Each runs the request the panel always sent; what changed is who may ask. A person's own
 * dialogs are the confirmation, so a person runs straight through; Voice is asked first for anything
 * that throws work away, writes history or reaches a remote.
 */
export function developerActions(document: StoreApi<DocumentState>, overrides: Partial<DeveloperMachine> = {}): ActionHandlers<void> {
    const machine: DeveloperMachine = { ...LIVE_MACHINE, ...overrides };

    const connected = (): Requester => {
        const transport = machine.transport();
        if (transport === null) {
            throw new ActionRefusal('offline', 'The machine of this project is not connected.');
        }
        return transport;
    };

    const projectFolder = (): string => {
        const folder = machine.folder();
        if (folder === null) {
            throw new ActionRefusal('no-folder', 'This project has no folder, so it has no repository.');
        }
        return folder;
    };

    const ask = async <Type extends RequestType>(type: Type, payload: RequestMap[Type]['payload']): Promise<RequestMap[Type]['result']> => {
        try {
            return await connected().request(type, payload);
        } catch (error: unknown) {
            throw asRefusal(error);
        }
    };

    /* A machine from before `git.repos` still has the folder itself, which is what the panel shows then too. */
    const allRepos = async (): Promise<GitRepo[]> => {
        const folder = projectFolder();
        return ask('git.repos', { folder })
            .then((answer) => answer.repos)
            .catch(() => soleRepo(folder));
    };

    const shownRepos = async (): Promise<Checkout[]> => visibleRepos(await allRepos(), machine.hiddenRepos());

    const worktreesOf = async (inspect: boolean): Promise<Worktree[]> =>
        (await ask('git.worktree-list', { repo: projectFolder(), ...(inspect ? { inspect: true } : {}) })).worktrees;

    const worktreeNamed = async (branch: string, inspect: boolean): Promise<Worktree> => {
        const worktrees = await worktreesOf(inspect);
        const worktree = worktrees.find((candidate) => candidate.branch === branch);
        if (!worktree) {
            throw new ActionRefusal(
                'unknown-worktree',
                `${branch} is not the branch of a worktree of this project. The worktrees are ${quoted(worktrees.map((entry) => entry.branch))}.`
            );
        }
        return worktree;
    };

    /*
     * The checkout a caller means. A person's panel names one by the path it read from the machine
     * itself; anyone else's words are looked up among the repositories and worktrees of the project.
     */
    const checkoutOf = async (repository: string, call: Call): Promise<Checkout> => {
        const folder = projectFolder();
        if (call.actor.kind === 'person' && isAbsolutePath(repository)) {
            return { path: repository, label: labelOf(folder, repository) };
        }
        const [repos, worktrees] = await Promise.all([allRepos(), worktreesOf(false).catch(() => [])]);
        const repo = repos.find((candidate) => candidate.label === repository || candidate.path === repository);
        if (repo) {
            return { path: repo.path, label: repo.label };
        }
        const worktree = worktrees.find((candidate) => !candidate.missing && (candidate.path === repository || candidate.branch === repository));
        if (worktree) {
            return { path: worktree.path, label: worktree.branch };
        }
        if (repository === folder || repository.startsWith(`${folder}/`)) {
            return { path: repository, label: labelOf(folder, repository) };
        }
        throw new ActionRefusal(
            'unknown-repository',
            `No repository or worktree of this project is called “${repository}”. The repositories are ${quoted(repos.map((entry) => entry.label))}.`
        );
    };

    /* One checkout, or every one the panel shows for null. */
    const checkoutsOf = async (repository: string | null | undefined, call: Call): Promise<Checkout[]> =>
        repository == null ? await shownRepos() : [await checkoutOf(repository, call)];

    const statusOf = (checkout: Checkout): Promise<GitStatus> => ask('git.status', { cwd: checkout.path });

    const statusesOf = (checkouts: readonly Checkout[]): Promise<{ checkout: Checkout; status: GitStatus }[]> =>
        Promise.all(checkouts.map(async (checkout) => ({ checkout, status: await statusOf(checkout) })));

    const runKind = async (
        checkout: Checkout,
        kind: GitActionKind,
        extra: Omit<GitActionPayload, 'cwd' | 'actionId' | 'kind'> = {},
        run: string | null | undefined = null
    ): Promise<GitRun> => runOutput(checkout, await ask('git.action', { cwd: checkout.path, actionId: run ?? machine.runId(), kind, ...extra }));

    /*
     * One checkout after another, never two at once. Named on its own, a refusal is the action's; over
     * every repository one that fails does not stop the rest, and each says how it went.
     */
    const runEach = async (
        checkouts: readonly Checkout[],
        single: boolean,
        kind: GitActionKind,
        extraOf: (checkout: Checkout) => Omit<GitActionPayload, 'cwd' | 'actionId' | 'kind'>,
        run: string | null | undefined
    ): Promise<GitRuns> => {
        if (checkouts.length === 0) {
            throw new ActionRefusal('nothing-to-do', 'No repository of this project has anything for this.');
        }
        const runs: GitRuns['runs'] = [];
        for (const checkout of checkouts) {
            try {
                runs.push({ ...(await runKind(checkout, kind, extraOf(checkout), single ? run : null)), error: null });
            } catch (error: unknown) {
                if (single) {
                    throw error;
                }
                const message = error instanceof Error ? error.message : 'The action failed.';
                const code = error instanceof ActionRefusal ? error.code : 'action-failed';
                runs.push({
                    repository: checkout.label,
                    path: checkout.path,
                    summary: '',
                    output: '',
                    commit: null,
                    url: null,
                    conflicts: [],
                    error: { code, message }
                });
            }
        }
        return { runs };
    };

    const pullQuestion = async (checkouts: readonly Checkout[], verb: 'Pull' | 'Sync') => {
        const statuses = await statusesOf(checkouts);
        return {
            confirmation: {
                title: `${verb} ${quoted(checkouts.map((checkout) => checkout.label))}?`,
                consequences: [
                    ...statuses.map(({ checkout, status }) =>
                        status.upstream === null
                            ? `${checkout.label}: ${branchOf(status)} has no upstream, so nothing is pulled${verb === 'Sync' ? ` and it is published to ${remoteOf(status)}` : ''}.`
                            : `${checkout.label}: ${branchOf(status)} from ${status.upstream}, ${plural(status.behind, 'commit')} behind${verb === 'Sync' ? ` and ${status.ahead} ahead to push` : ''}.`
                    ),
                    'Only a fast-forward: a branch that moved on both sides is refused, and the user decides in the app how it comes together.'
                ]
            }
        };
    };

    return {
        'git.status': async ({ repository }, call) => {
            const repos = await allRepos();
            const checkouts = repository == null ? visibleRepos(repos, machine.hiddenRepos()) : [await checkoutOf(repository, call)];
            const worktreePaths = repository == null ? new Set<string>() : new Set((await worktreesOf(false).catch(() => [])).map((entry) => entry.path));
            const repositories = await Promise.all(
                checkouts.map(async (checkout) => {
                    // A path inside the folder that is no repository of its own is read as the one it sits in.
                    const kind: GitRepoKind | 'worktree' =
                        repos.find((repo) => repo.path === checkout.path)?.kind ?? (worktreePaths.has(checkout.path) ? 'worktree' : 'nested');
                    try {
                        return { repository: checkout.label, path: checkout.path, kind, status: await statusOf(checkout), error: null };
                    } catch (error: unknown) {
                        if (repository != null) {
                            throw error;
                        }
                        return {
                            repository: checkout.label,
                            path: checkout.path,
                            kind,
                            status: null,
                            error: error instanceof Error ? error.message : 'Unreadable'
                        };
                    }
                })
            );
            return { output: { repositories } };
        },
        'git.diff': async ({ repository, path, scope, commit, staged, ignoreWhitespace, base }, call) => {
            const checkout = await checkoutOf(repository, call);
            const diff = await ask('git.diff', {
                cwd: checkout.path,
                scope,
                ...(path == null ? {} : { path }),
                ...(commit == null ? {} : { commit }),
                ...(staged == null ? {} : { staged }),
                ...(ignoreWhitespace == null ? {} : { ignoreWhitespace }),
                ...(base == null ? {} : { base })
            });
            return { output: diff };
        },
        'git.log': async ({ repository, limit, cursor }, call) => {
            const checkout = await checkoutOf(repository, call);
            return { output: await ask('git.log', { cwd: checkout.path, limit: limit ?? 20, ...(cursor == null ? {} : { cursor }) }) };
        },
        'git.refs': async ({ repository }, call) => ({ output: await ask('git.refs', { cwd: (await checkoutOf(repository, call)).path }) }),
        'git.conflicts': async ({ repository }, call) => ({ output: await ask('git.conflicts', { cwd: (await checkoutOf(repository, call)).path }) }),
        'git.conflict': async ({ repository, path }, call) => ({ output: await ask('git.conflict', { cwd: (await checkoutOf(repository, call)).path, path }) }),
        'git.stage': async ({ repository, paths }, call) => {
            const checkout = await checkoutOf(repository, call);
            await ask('git.stage', { cwd: checkout.path, paths, staged: true });
            return { output: { repository: checkout.label, paths } };
        },
        'git.unstage': async ({ repository, paths }, call) => {
            const checkout = await checkoutOf(repository, call);
            await ask('git.stage', { cwd: checkout.path, paths, staged: false });
            return { output: { repository: checkout.label, paths } };
        },
        'git.discard': async ({ repository, paths }, call) => {
            const checkout = await checkoutOf(repository, call);
            if (asksFirst(call)) {
                return {
                    confirmation: {
                        title: `Discard the changes to ${plural(paths.length, 'file')} in ${checkout.label}?`,
                        consequences: [filesLine(paths), 'The changes go into a stash, which brings them back until it is dropped.']
                    }
                };
            }
            const { stash } = await ask('git.discard', { cwd: checkout.path, paths });
            return { output: { repository: checkout.label, paths, stash } };
        },
        'git.suggestCommitMessage': async ({ repository, run }, call) => {
            let checkout: Checkout;
            if (repository == null) {
                const { targets } = commitTargets((await statusesOf(await shownRepos())).map(({ checkout: entry, status }) => ({ ...entry, status })));
                if (targets.length !== 1) {
                    throw new ActionRefusal('name-a-repository', 'A message is written from one repository’s staged diff; name the repository.');
                }
                checkout = { path: targets[0]!.path, label: targets[0]!.label };
            } else {
                checkout = await checkoutOf(repository, call);
            }
            const suggestion = await ask('git.suggestMessage', { cwd: checkout.path, actionId: run ?? machine.runId() });
            return { output: { repository: checkout.label, ...suggestion } };
        },
        'git.commit': async ({ repository, message, body, push, stageAll, run }, call) => {
            const kind: GitActionKind = push === true ? 'commit-push' : 'commit';
            const extra = { subject: message, ...(body == null || body.trim() === '' ? {} : { body }) };
            // The panel already weighed where the commit lands and says so; anyone else's commit is weighed here.
            if (repository != null && stageAll != null) {
                return { output: await runEach([await checkoutOf(repository, call)], true, kind, () => ({ ...extra, stageAll }), run) };
            }
            // Named alone, a repository with changes and nothing staged is committed whole, as a folder with one repository is.
            const statuses = await statusesOf(await checkoutsOf(repository, call));
            const { targets: chosen, stageAll: stagesAll } = commitTargets(statuses.map(({ checkout, status }) => ({ ...checkout, status })));
            if (chosen.length === 0) {
                throw new ActionRefusal(
                    'nothing-to-commit',
                    statuses.some(({ status }) => status.files.length > 0)
                        ? 'Nothing is staged, and more than one repository has changes: stage what belongs in the commit first.'
                        : 'There are no changes to commit.'
                );
            }
            if (asksFirst(call)) {
                return {
                    confirmation: {
                        title: `Commit “${message}” in ${quoted(chosen.map((target) => target.label))}?`,
                        consequences: chosen.flatMap((target) => {
                            const status = target.status!;
                            const files = changedFiles(status, !stagesAll);
                            return [
                                `${target.label} on ${branchOf(status)}: ${filesLine(files)}${stagesAll ? ', staged first' : ''}.`,
                                ...(push === true ? [`Then pushed to ${remoteOf(status)}.`] : [])
                            ];
                        })
                    }
                };
            }
            return {
                output: await runEach(
                    chosen.map((target) => ({ path: target.path, label: target.label })),
                    repository != null,
                    kind,
                    () => ({ ...extra, stageAll: stagesAll }),
                    run
                )
            };
        },
        'git.fetch': async ({ repository, run }, call) => ({
            output: await runEach(await checkoutsOf(repository, call), repository != null, 'fetch', () => ({}), run)
        }),
        'git.pull': async ({ repository, strategy, run }, call) => {
            const checkouts = await checkoutsOf(repository, call);
            if (asksFirst(call)) {
                return pullQuestion(checkouts, 'Pull');
            }
            return { output: await runEach(checkouts, repository != null, 'pull', () => (strategy == null ? {} : { strategy }), run) };
        },
        'git.sync': async ({ repository, strategy, run }, call) => {
            const checkouts = await checkoutsOf(repository, call);
            if (asksFirst(call)) {
                return pullQuestion(checkouts, 'Sync');
            }
            return { output: await runEach(checkouts, repository != null, 'sync', () => (strategy == null ? {} : { strategy }), run) };
        },
        'git.push': async ({ repository, run }, call) => {
            const checkouts = await checkoutsOf(repository, call);
            if (call.actor.kind === 'person' && repository != null) {
                return { output: await runEach(checkouts, true, 'push', () => ({}), run) };
            }
            const statuses = await statusesOf(checkouts);
            // Over the whole folder only what has commits for an upstream it already has; publishing is its own question.
            const ready = statuses.filter(({ status }) => status.branch !== null && (repository != null || (status.upstream !== null && status.ahead > 0)));
            if (ready.length === 0) {
                throw new ActionRefusal('nothing-to-push', 'No repository has commits to push to an upstream.');
            }
            if (asksFirst(call)) {
                return {
                    confirmation: {
                        title: `Push ${quoted(ready.map(({ checkout }) => checkout.label))}?`,
                        consequences: ready.map(
                            ({ checkout, status }) => `${checkout.label}: ${plural(status.ahead, 'commit')} of ${branchOf(status)} to ${remoteOf(status)}.`
                        )
                    }
                };
            }
            return {
                output: await runEach(
                    ready.map(({ checkout }) => checkout),
                    repository != null,
                    'push',
                    () => ({}),
                    run
                )
            };
        },
        'git.publishBranch': async ({ repository, run }, call) => {
            const checkout = await checkoutOf(repository, call);
            if (asksFirst(call)) {
                const status = await statusOf(checkout);
                return {
                    confirmation: {
                        title: `Publish ${branchOf(status)} of ${checkout.label}?`,
                        consequences: [`Pushes ${branchOf(status)} to origin and sets it as its upstream.`]
                    }
                };
            }
            return { output: await runKind(checkout, 'publish', {}, run) };
        },
        'git.forcePush': async ({ repository, run }, call) => ({ output: await runKind(await checkoutOf(repository, call), 'force-push', {}, run) }),
        'git.checkout': async ({ repository, branch, stashFirst, run }, call) => {
            const checkout = await checkoutOf(repository, call);
            if (call.actor.kind === 'person') {
                return { output: await runKind(checkout, 'checkout', { ref: branch, ...(stashFirst === true ? { stash: true } : {}) }, run) };
            }
            const status = await statusOf(checkout);
            const dirty = status.files.length > 0;
            if (dirty && !call.confirmed) {
                return {
                    confirmation: {
                        title: `Switch ${checkout.label} to ${branch}?`,
                        consequences: [
                            `${checkout.label} has ${plural(status.files.length, 'changed file')} on ${branchOf(status)}: ${filesLine(changedFiles(status, false))}.`,
                            'They go into a stash first, which git.popStash brings back.'
                        ]
                    }
                };
            }
            return { output: await runKind(checkout, 'checkout', { ref: branch, ...(dirty ? { stash: true } : {}) }, run) };
        },
        'git.createBranch': async ({ repository, name, run }, call) => ({
            output: await runKind(await checkoutOf(repository, call), 'create-branch', { name }, run)
        }),
        'git.renameBranch': async ({ repository, name, run }, call) => ({
            output: await runKind(await checkoutOf(repository, call), 'rename-branch', { name }, run)
        }),
        'git.deleteBranch': async ({ repository, branch, force, run }, call) => {
            const checkout = await checkoutOf(repository, call);
            if (asksFirst(call)) {
                return {
                    confirmation: {
                        title: `Delete the branch ${branch} in ${checkout.label}?`,
                        consequences: ['Only a branch git has merged is deleted; one with commits no other branch has is refused.']
                    }
                };
            }
            return { output: await runKind(checkout, 'delete-branch', { ref: branch, ...(force === true ? { force: true } : {}) }, run) };
        },
        'git.merge': async ({ repository, branch, run }, call) => {
            const checkout = await checkoutOf(repository, call);
            if (asksFirst(call)) {
                const status = await statusOf(checkout);
                return {
                    confirmation: {
                        title: `Merge ${branch} into ${branchOf(status)} in ${checkout.label}?`,
                        consequences: ['A conflict stops the merge halfway; the user resolves it or takes it back in the app.']
                    }
                };
            }
            return { output: await runKind(checkout, 'merge', { ref: branch }, run) };
        },
        'git.rebase': async ({ repository, onto, run }, call) => ({ output: await runKind(await checkoutOf(repository, call), 'rebase', { ref: onto }, run) }),
        'git.stash': async ({ repository, message, run }, call) => ({
            output: await runKind(await checkoutOf(repository, call), 'stash', message == null ? {} : { subject: message }, run)
        }),
        'git.popStash': async ({ repository, stash, run }, call) => {
            const checkout = await checkoutOf(repository, call);
            if (asksFirst(call)) {
                const { stashes } = await ask('git.refs', { cwd: checkout.path });
                const entry = stashes.find((candidate) => candidate.ref === stash);
                if (!entry) {
                    throw new ActionRefusal('unknown-stash', `${checkout.label} has no stash ${stash}.`);
                }
                return {
                    confirmation: {
                        title: `Take the stash ${stash} back in ${checkout.label}?`,
                        consequences: [
                            `“${entry.message}” is applied to the working tree and dropped once it applied.`,
                            'It can conflict with changes made since.'
                        ]
                    }
                };
            }
            return { output: await runKind(checkout, 'stash-pop', { ref: stash }, run) };
        },
        'git.createPullRequest': async ({ repository, title, body, run }, call) => {
            const checkout = await checkoutOf(repository, call);
            if (asksFirst(call)) {
                const status = await statusOf(checkout);
                return {
                    confirmation: {
                        title: `Open a pull request “${title}” for ${branchOf(status)} of ${checkout.label}?`,
                        consequences: [
                            ...(status.upstream === null ? [`${branchOf(status)} is published to origin first.`] : []),
                            'The pull request is public to everyone with access to the repository.'
                        ]
                    }
                };
            }
            return { output: await runKind(checkout, 'create-pr', { subject: title, ...(body == null ? {} : { body }) }, run) };
        },
        'git.proposeResolution': async ({ repository, path, run }, call) => ({
            output: await ask('git.resolveAi', { cwd: (await checkoutOf(repository, call)).path, path, actionId: run ?? machine.runId() })
        }),
        'git.resolveConflict': async ({ repository, path, content, take, hash }, call) => {
            if ((content == null) === (take == null)) {
                throw new ActionRefusal('invalid-resolution', 'A resolution is either the merged file or one side whole, never both or neither.');
            }
            if (content != null && hash == null) {
                throw new ActionRefusal('invalid-resolution', 'A merged file is written over the digest git.conflict read it at.');
            }
            const checkout = await checkoutOf(repository, call);
            return {
                output: await ask('git.resolve', {
                    cwd: checkout.path,
                    path,
                    ...(content == null ? {} : { content }),
                    ...(take == null ? {} : { take }),
                    ...(hash == null ? {} : { hash })
                })
            };
        },
        'git.operation': async ({ repository, step, run }, call) => {
            const checkout = await checkoutOf(repository, call);
            if (asksFirst(call)) {
                const { operation, files } = await ask('git.conflicts', { cwd: checkout.path });
                if (operation === null) {
                    throw new ActionRefusal('no-operation', `Nothing waits halfway in ${checkout.label}.`);
                }
                return {
                    confirmation: {
                        title: `Take back the ${operation} in ${checkout.label}?`,
                        consequences: [
                            `The checkout goes back to how it was before the ${operation}.`,
                            ...(files.length > 0 ? [`What was resolved in ${filesLine(files.map((file) => file.path))} is lost.`] : [])
                        ]
                    }
                };
            }
            const result = await ask('git.operation', { cwd: checkout.path, actionId: run ?? machine.runId(), action: step });
            return { output: runOutput(checkout, result) };
        },
        'worktree.list': async () => {
            const nodes = document
                .getState()
                .exportViews()
                .flatMap((view) => (isCanvasView(view) ? view.nodes : []));
            const worktrees = await worktreesOf(true);
            return {
                output: {
                    worktrees: worktrees.map((worktree) => ({
                        branch: worktree.branch,
                        path: worktree.missing ? null : worktree.path,
                        nodes: nodesInWorktree(
                            nodes.map((node) => ({
                                id: node.id,
                                kind: node.kind,
                                title: node.title,
                                ...('cwd' in node && typeof node.cwd === 'string' ? { cwd: node.cwd } : {})
                            })),
                            worktree
                        ).map((node) => node.id),
                        from: worktree.from?.branch ?? null,
                        changed: worktree.work?.changed ?? 0,
                        untracked: worktree.work?.untracked ?? 0,
                        ahead: worktree.work?.ahead ?? 0
                    }))
                }
            };
        },
        'worktree.diff': async ({ branch }) => {
            const worktree = await worktreeNamed(branch, false);
            if (worktree.missing) {
                throw new ActionRefusal('worktree-missing', `The folder of ${branch} is gone, so there is nothing to diff.`);
            }
            const base = worktree.from?.branch ?? worktree.from?.commit;
            const diff = await ask('git.diff', { cwd: worktree.path, scope: 'base', ...(base === undefined ? {} : { base }) });
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
        'worktree.create': async ({ branch }, call) => {
            const folder = projectFolder();
            if (asksFirst(call)) {
                return {
                    confirmation: {
                        title: `Create a worktree on ${branch}?`,
                        consequences: [
                            `A checkout of ${basenameOf(folder)} on ${branch}, with the branch made when it does not exist, outside the project folder.`
                        ]
                    }
                };
            }
            const projectId = machine.projectId();
            return { output: await ask('git.worktree-add', { repo: folder, branch, ...(projectId === null ? {} : { projectId }) }) };
        },
        'worktree.merge': async ({ branch, strategy, message, body, commitFirst, remove, stopAgent, into, run }, call) => {
            const folder = projectFolder();
            const worktree = await worktreeNamed(branch, call.actor.kind !== 'person');
            if (worktree.missing) {
                throw new ActionRefusal('worktree-missing', `The folder of ${branch} is gone, so there is nothing to merge.`);
            }
            const loose = (worktree.work?.changed ?? 0) + (worktree.work?.untracked ?? 0);
            const target = into ?? worktree.from?.branch ?? null;
            if (asksFirst(call)) {
                return {
                    confirmation: {
                        title: `Merge the worktree ${branch} into ${target ?? 'the branch it was made from'}?`,
                        consequences: [
                            `${plural(worktree.work?.ahead ?? 0, 'commit')} ${strategy === 'squash' ? 'squashed into one commit' : 'with a merge commit'}.`,
                            ...(loose > 0 ? [`${plural(loose, 'uncommitted file')} committed first.`] : []),
                            'A conflict stops the merge halfway for the user; the worktree and its branch stay.'
                        ]
                    }
                };
            }
            const title = document
                .getState()
                .exportViews()
                .flatMap((view) => (isCanvasView(view) ? view.nodes : []))
                .find((node) => node.id === worktree.nodeId)?.title;
            const subject = message ?? `${title?.trim() || branch}: work of the agent`;
            const commits = commitFirst ?? (call.actor.kind !== 'person' && loose > 0);
            const result = await ask('git.worktree-merge', {
                repo: folder,
                path: worktree.path,
                actionId: run ?? machine.runId(),
                strategy,
                subject,
                ...(body == null ? {} : { body }),
                ...(commits ? { commitFirst: true } : {}),
                ...(remove === true ? { remove: true } : {}),
                ...(stopAgent === true ? { stopAgent: true } : {}),
                ...(into == null ? {} : { into })
            });
            return {
                output: {
                    branch,
                    into: result.into ?? target,
                    strategy,
                    summary: result.summary,
                    output: result.output,
                    ...(result.cwd === undefined ? {} : { cwd: result.cwd }),
                    ...(result.conflicts === undefined ? {} : { conflicts: result.conflicts }),
                    ...(result.removed === undefined ? {} : { removed: result.removed }),
                    ...(result.branchDeleted === undefined ? {} : { branchDeleted: result.branchDeleted }),
                    ...(result.kept === undefined ? {} : { kept: result.kept })
                }
            };
        },
        'worktree.remove': async ({ branch, force }) => {
            const worktree = await worktreeNamed(branch, false);
            const result = await ask('git.worktree-remove', { repo: projectFolder(), path: worktree.path, ...(force === true ? { force: true } : {}) });
            return { output: { branch, branchDeleted: result.branchDeleted ?? null, branchCommit: result.branchCommit ?? null } };
        }
    };
}
