import { dirname, resolve } from 'node:path';
import { CodedError } from '@adecore/agents';
import type { AgentKind, GitActionKind, GitActionPhase } from '@ruimte/contracts';
import type { Area } from '../area.ts';
import type { MachineHome } from '../disk/machine-home.ts';
import { type Dispatcher, type UsageCount } from '../dispatcher.ts';
import { GitActions } from '../git/actions.ts';
import { authorPictures } from '../git/author-pictures.ts';
import { blameFile } from '../git/blame.ts';
import { fetchBundle, makeBundle, type BundleStore } from '../git/bundles.ts';
import { readCapabilities } from '../git/capabilities.ts';
import type { CheckpointService } from '../git/checkpoints.ts';
import { cloneRepository } from '../git/clone.ts';
import { compareBranches, compareCommits, readSnapshot } from '../git/compare.ts';
import { readConflict, readConflicts, resolveConflict, runOperation } from '../git/conflict.ts';
import { diffCheckout, diffCommit, diffFile } from '../git/diff.ts';
import { parseIssueRef, readIssue, readPullRequest, runGh } from '../git/github.ts';
import { IdentityReader } from '../git/identity.ts';
import { listIgnoredFiles } from '../git/ignored.ts';
import { readLog } from '../git/log.ts';
import { suggestMessage } from '../git/message.ts';
import type { TextWriter } from '../git/one-shot.ts';
import { prSplits } from '../git/pr-split.ts';
import { listRefs, readRefCommit } from '../git/refs.ts';
import { cachedRepos } from '../git/repo-cache.ts';
import { resolveWithAgent } from '../git/resolve-ai.ts';
import { GitError, toplevel, type LeftOut } from '../git/run.ts';
import { discardPaths, stagePaths, unstagePaths } from '../git/stage.ts';
import type { GitStatusWatcher } from '../git/status-watcher.ts';
import { mergeBaseWith } from '../git/status.ts';
import type { WorktreeMerge } from '../git/worktree-merge.ts';
import type { Worktrees } from '../git/worktrees.ts';
import type { PrWatchStore } from '../github/pr-watch.ts';
import type { OneShotPlace } from '../peer/worker/one-shot-place.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { ShortTextModels } from '../short-text/model.ts';
import { sendEvent, type ClientConnection } from '../wire.ts';

export interface GitDeps {
    worktrees: Worktrees;
    merges: WorktreeMerge;
    statuses: GitStatusWatcher;
    providers: ProviderRegistry;
    prWatches: PrWatchStore;
    placeOf(id: string): { projectId: string } | null;
    machineHome: Pick<MachineHome, 'refuse' | 'refuseHolding' | 'stateWithin'>;
    bundles: BundleStore;
    checkpoints: Pick<CheckpointService, 'take' | 'head'>;
    folderOf(projectId: string): Promise<string | null>;
    /* Whether a checkout lies in a folder made from another machine's work. */
    untrusted(path: string): boolean;
    /* Writes down a folder this machine never vouched for, before git makes it. */
    untrustFolder(path: string, branch: string): Promise<void>;
    oneShotPlace: Pick<OneShotPlace, 'cwdFor'>;
    /* The machine's text model, which writes commit messages and conflict proposals when it has a pick. */
    textModels: Pick<ShortTextModels, 'choice' | 'prepare'>;
}

interface AgentRunOptions {
    provider?: AgentKind;
    writer?: TextWriter;
    onSpawn(kill: () => void): void;
    cwdFor(folder: string): Promise<string>;
}

const GIT_ACTION_COUNTERS: Readonly<Partial<Record<GitActionKind, readonly UsageCount[]>>> = {
    commit: ['git.commits'],
    'commit-push': ['git.commits', 'git.pushes'],
    push: ['git.pushes'],
    'force-push': ['git.pushes'],
    publish: ['git.pushes'],
    pull: ['git.pulls'],
    sync: ['git.pulls', 'git.pushes']
};

/* Streams an action's progress to the client that asked, under the action id it chose. */
function progressTo(client: ClientConnection, cwd: string, actionId: string) {
    return (phase: GitActionPhase, line: string): void => {
        sendEvent(client, 'git.progress', { cwd, actionId, phase, line });
    };
}

export function gitArea(deps: GitDeps): Area {
    const { statuses, worktrees, prWatches } = deps;

    return {
        name: 'git',
        sources: [statuses, worktrees, prWatches],
        holders: [statuses],
        handlers: (dispatcher) => registerRequests(dispatcher, deps),
        stop: [{ phase: 'halt', label: 'Closing the pull request watches', run: () => prWatches.close() }]
    };
}

function registerRequests(dispatcher: Dispatcher, deps: GitDeps): void {
    const {
        worktrees,
        merges,
        statuses,
        providers,
        prWatches,
        placeOf,
        machineHome,
        bundles,
        checkpoints,
        folderOf,
        untrusted,
        untrustFolder,
        oneShotPlace,
        textModels
    } = deps;
    // A checkout may hold the home, so what runs over all of it leaves the machine's state out and keeps the open folders.
    const leftOut: LeftOut = (top) => machineHome.stateWithin(top);
    const actions = new GitActions(leftOut);
    const identities = new IdentityReader();

    // Judged before any git runs, like the file requests: a client asks about folders, never about the machine's own state.
    const refuse = async (...folders: string[]): Promise<void> => {
        await Promise.all(folders.map((folder) => machineHome.refuse(folder)));
    };

    // A file is named relative to the root of its checkout, which may hold the home, so each is judged where it really lies.
    const refuseFiles = async (cwd: string, paths: readonly string[]): Promise<void> => {
        await machineHome.refuse(cwd);
        const top = await toplevel(cwd);
        await Promise.all(paths.map((path) => machineHome.refuseHolding(resolve(top, path))));
    };

    dispatcher.register('git.worktree-add', async (payload) => {
        await refuse(payload.repo);

        return await worktrees.add(
            payload.repo,
            payload.branch,
            { madeBy: 'client', ...(payload.projectId === undefined ? {} : { projectId: payload.projectId }) },
            payload.base === undefined ? {} : { base: payload.base }
        );
    });

    dispatcher.register('git.worktree-list', async (payload) => {
        await refuse(payload.repo);
        return { worktrees: await worktrees.list(payload.repo, { inspect: payload.inspect === true }) };
    });

    dispatcher.register('git.worktree-remove', async (payload) => {
        await refuse(payload.repo, payload.path);

        return await worktrees.remove(payload.repo, payload.path, {
            ...(payload.force === undefined ? {} : { force: payload.force }),
            ...(payload.keepBranch === undefined ? {} : { keepBranch: payload.keepBranch }),
            ...(payload.stopAgent === undefined ? {} : { stopAgent: payload.stopAgent })
        });
    });

    dispatcher.register('git.worktree-merge', async (payload, client) => {
        await refuse(payload.repo, payload.path);
        return await merges.merge(payload, progressTo(client, payload.path, payload.actionId));
    });

    dispatcher.register('git.worktree-abort', async (payload) => {
        await refuse(payload.cwd);
        await merges.abort(payload.cwd);

        return {};
    });

    dispatcher.register('git.status', async (payload) => {
        await refuse(payload.cwd);
        return await statuses.status(payload.cwd);
    });

    dispatcher.register('git.watch', async (payload, client) => {
        await refuse(payload.cwd);
        await statuses.watch(client.id, payload.cwd);
        if (client.closed) {
            statuses.detachAll(client.id);
            return {};
        }
        // Read after the watch is up, so a write in between is in this status or reported after it.
        return payload.status === true ? { status: await statuses.status(payload.cwd) } : {};
    });

    dispatcher.register('git.unwatch', (payload, client) => {
        statuses.unwatch(client.id, payload.cwd);
        return {};
    });

    dispatcher.register('git.diff', async (payload) => {
        await refuseFiles(payload.cwd, payload.path === undefined ? [] : [payload.path]);

        if (payload.scope === 'commit' && payload.path === undefined) {
            return await diffCommit(payload.cwd, payload.commit ?? 'HEAD', leftOut);
        }
        if (payload.scope === 'base' && payload.path === undefined) {
            return await diffCheckout(payload.cwd, await mergeBaseWith(payload.cwd, payload.base), leftOut);
        }
        if (payload.path === undefined) {
            throw new CodedError('bad-request', 'A diff of this scope needs a path.');
        }
        const options = {
            scope: payload.scope,
            staged: payload.staged ?? false,
            ignoreWhitespace: payload.ignoreWhitespace ?? false,
            ...(payload.commit ? { commit: payload.commit } : {})
        };
        return await diffFile(payload.cwd, payload.path, options, await mergeBaseWith(payload.cwd, payload.base));
    });

    dispatcher.register('git.compare', async (payload) => {
        await refuse(payload.cwd);
        return await compareBranches(payload.cwd, payload.from, payload.to, payload.mode, leftOut);
    });

    dispatcher.register('git.compareCommits', async (payload) => {
        await refuse(payload.cwd);
        return await compareCommits(payload.cwd, payload.fromCommit, payload.toCommit, payload.side, payload.skip, payload.limit);
    });

    dispatcher.register('git.blob', async (payload) => {
        await refuseFiles(payload.cwd, [payload.path]);
        return await readSnapshot(payload.cwd, payload.commit, payload.path);
    });

    dispatcher.register('git.blame', async (payload) => {
        await refuseFiles(payload.cwd, [payload.path]);
        return await blameFile(payload.cwd, payload.path);
    });

    dispatcher.register('git.identity', async (payload) => {
        await refuse(...payload.paths);
        return identities.read(payload.paths);
    });

    // A person's handoff is theirs to vouch for, except for work this machine never vouched for itself: that stays so where it goes.
    dispatcher.register('git.bundle', async (payload, client) => {
        await machineHome.refuse(payload.path);
        const id = crypto.randomUUID();
        bundles.admit(client.id, id);
        const made = await makeBundle(bundles, checkpoints, payload, id).catch(async (error: unknown) => {
            await bundles.discard(id);
            throw error;
        });
        await bundles.keep(made.bundleId, client.id);
        return untrusted(payload.path) ? { ...made, untrusted: true } : made;
    });

    dispatcher.register('git.bundlePut', async (payload) => ({
        received: await bundles.receive(payload.bundleId, payload.offset, Buffer.from(payload.data, 'base64'), payload.total)
    }));

    dispatcher.register('git.fetchBundle', async (payload) => {
        const folder = await folderOf(payload.projectId);
        if (folder === null) {
            throw new CodedError('project-not-found', `No project ${payload.projectId} is on this machine`);
        }
        return fetchBundle(bundles, worktrees, folder, payload, payload.untrusted === true ? untrustFolder : undefined);
    });

    dispatcher.register('git.stage', async (payload) => {
        await refuseFiles(payload.cwd, payload.paths);
        await (payload.staged ? stagePaths(payload.cwd, payload.paths) : unstagePaths(payload.cwd, payload.paths));

        return {};
    });

    dispatcher.register('git.discard', async (payload) => {
        await refuseFiles(payload.cwd, payload.paths);
        return await discardPaths(payload.cwd, payload.paths);
    });

    dispatcher.register('git.refs', async (payload) => {
        await refuse(payload.cwd);
        return await listRefs(payload.cwd);
    });

    dispatcher.register('git.issue', async (payload) => {
        await refuse(payload.cwd);
        const ref = parseIssueRef(payload.ref);
        if (ref === null) {
            throw new GitError('issue-not-found', 'Name the issue as a link, owner/repo#12 or #12.');
        }
        return await readIssue(runGh, payload.cwd, ref);
    });

    // The split waits on every page of GitHub's file list, so it is a request of its own and the dialog draws before it.
    dispatcher.register('git.pr', async (payload) => {
        await refuse(payload.cwd);
        const pr = await readPullRequest(runGh, payload.cwd, payload.number);
        if (pr !== null) {
            prSplits.note(payload.cwd, pr);
        }
        return { pr };
    });

    dispatcher.register('git.prSplit', async (payload) => {
        await refuse(payload.cwd);

        return {
            split: await prSplits.splitAt(payload.cwd, payload.number, payload.headSha, () => readPullRequest(runGh, payload.cwd, payload.number))
        };
    });

    dispatcher.register(
        'git.pr-watch',
        async (payload) => {
            // A client names the project and the chat, so the machine checks that the project really holds the chat.
            if (placeOf(payload.chatId)?.projectId !== payload.projectId) {
                throw new GitError('pr-watch-refused', 'That chat is not part of this project.');
            }
            await refuse(payload.cwd);
            return { watch: await prWatches.start(payload.projectId, payload.chatId, payload.cwd, payload.number) };
        },
        { count: ['prWatches.started'] }
    );
    dispatcher.register('git.pr-unwatch', async (payload) => {
        await prWatches.stop(payload.chatId);
        return {};
    });
    dispatcher.register('git.pr-watches', (payload) => ({ watches: prWatches.list(payload.projectId) }));

    dispatcher.register('git.ref-commit', async (payload) => {
        await refuse(payload.cwd);
        return await readRefCommit(payload.cwd, payload.ref);
    });

    dispatcher.register('git.repos', async (payload) => {
        await refuse(payload.folder);
        return await cachedRepos(payload.folder, payload.fresh === true);
    });

    dispatcher.register('git.log', async (payload) => {
        await refuse(payload.cwd);
        return await readLog(payload.cwd, payload.limit, payload.cursor);
    });

    dispatcher.register('git.authors', async (payload) => {
        await refuse(payload.cwd);
        return { authors: await authorPictures.authorsOf(payload.cwd) };
    });

    dispatcher.register('git.capabilities', () => readCapabilities(providers, Date.now(), textModels.choice()?.provider));

    /* Progress streams while the git runs; the reply lands after. */
    dispatcher.register(
        'git.action',
        async (payload, client) => {
            await refuse(payload.cwd);
            return await actions.run(payload, progressTo(client, payload.cwd, payload.actionId));
        },
        { count: (payload) => GIT_ACTION_COUNTERS[payload.kind] ?? [] }
    );

    /*
     * A person's client putting a project on this machine: the folder is judged like a file request's
     * path, before git makes it. Not on a peer's list, and no agent reaches it.
     */
    dispatcher.register('git.clone', async (payload, client) => {
        await Promise.all([machineHome.refuse(payload.path), machineHome.refuse(dirname(payload.path))]);
        const slot = actions.claim(payload.actionId);
        let canceled = false;
        try {
            return await cloneRepository({
                url: payload.url,
                path: payload.path,
                job: {
                    hold: (kill) =>
                        slot.hold(() => {
                            canceled = true;
                            kill();
                        }),
                    get canceled() {
                        return canceled;
                    }
                },
                onProgress: progressTo(client, payload.path, payload.actionId)
            });
        } finally {
            slot.release();
        }
    });

    dispatcher.register('git.ignoredFiles', async (payload) => {
        await refuse(payload.cwd);
        return listIgnoredFiles(payload.cwd);
    });

    dispatcher.register('git.cancel', (payload) => {
        actions.cancel(payload.actionId);
        merges.cancel(payload.actionId);
        return {};
    });

    dispatcher.register('git.conflicts', async (payload) => {
        await refuse(payload.cwd);
        return await readConflicts(payload.cwd);
    });

    dispatcher.register('git.conflict', async (payload) => {
        await refuseFiles(payload.cwd, [payload.path]);
        return await readConflict(payload.cwd, payload.path);
    });

    dispatcher.register(
        'git.resolve',
        async (payload) => {
            await refuseFiles(payload.cwd, [payload.path]);
            return { remaining: await resolveConflict(payload) };
        },
        { count: ['git.conflictsResolved'] }
    );

    dispatcher.register('git.operation', async (payload, client) => {
        await refuse(payload.cwd);
        return await runOperation(payload.cwd, payload.action, payload.actionId, progressTo(client, payload.cwd, payload.actionId));
    });

    /* An agent CLI behind a cancellable action: `git.cancel` with its id kills what it spawned. */
    const runAgent = async <T>(actionId: string, provider: AgentKind | undefined, run: (options: AgentRunOptions) => Promise<T>): Promise<T> => {
        const job = actions.claim(actionId);
        try {
            // The machine's pick answers when it has one; a hint that disagrees is refused there.
            const writer = await textModels.prepare(provider);

            return await run({
                ...(provider ? { provider } : {}),
                ...(writer ? { writer } : {}),
                cwdFor: (folder: string) => oneShotPlace.cwdFor(folder),
                onSpawn: (kill) => job.hold(kill)
            });
        } finally {
            job.release();
        }
    };

    dispatcher.register('git.resolveAi', async (payload) => {
        await refuseFiles(payload.cwd, [payload.path]);

        return await runAgent(payload.actionId, payload.provider, async (options) =>
            resolveWithAgent(payload.cwd, payload.path, await readConflicts(payload.cwd), providers, options)
        );
    });

    dispatcher.register('git.suggestMessage', async (payload) => {
        await refuse(payload.cwd);
        return await runAgent(payload.actionId, payload.provider, (options) => suggestMessage(payload.cwd, providers, options));
    });
}
