import { dirname } from 'node:path';
import type { AgentKind, GitActionPhase } from '@ruimte/contracts';
import { RequestError, sendEvent, type ClientConnection, type Dispatcher } from '../dispatcher.ts';
import { fetchBundle, makeBundle, type BundleStore } from '../git/bundles.ts';
import type { CheckpointService } from '../git/checkpoints.ts';
import { GitActions } from '../git/actions.ts';
import { cloneRepository } from '../git/clone.ts';
import { listIgnoredFiles } from '../git/ignored.ts';
import { blameFile } from '../git/blame.ts';
import { readCapabilities } from '../git/capabilities.ts';
import { readConflict, readConflicts, resolveConflict, runOperation } from '../git/conflict.ts';
import { resolveWithAgent } from '../git/resolve-ai.ts';
import { diffCheckout, diffCommit, diffFile } from '../git/diff.ts';
import { IdentityReader } from '../git/identity.ts';
import { readLog } from '../git/log.ts';
import { suggestMessage } from '../git/message.ts';
import { parseIssueRef, readIssue, readPullRequest, runGh } from '../git/github.ts';
import { prSplits } from '../git/pr-split.ts';
import { GitError } from '../git/run.ts';
import type { MachineHome } from '../fs/machine-home.ts';
import type { PrWatchStore } from '../github/pr-watch.ts';
import { listRefs, readRefCommit } from '../git/refs.ts';
import { cachedRepos } from '../git/repo-cache.ts';
import { discardPaths, stagePaths, unstagePaths } from '../git/stage.ts';
import type { GitStatusWatcher } from '../git/status-watcher.ts';
import { mergeBaseWith } from '../git/status.ts';
import type { WorktreeMerge } from '../git/worktree-merge.ts';
import type { Worktrees } from '../git/worktrees.ts';
import type { OneShotPlace } from '../peering/one-shot-place.ts';
import type { ProviderRegistry } from '../providers/registry.ts';

/* What writing and taking in a bundle needs from the rest of the daemon. */
export interface BundleHost {
    bundles: BundleStore;
    checkpoints: Pick<CheckpointService, 'take' | 'head'>;
    folderOf(projectId: string): Promise<string | null>;
    /* Whether a checkout lies in a folder made from another machine's work. */
    untrusted?(path: string): boolean;
    /* Writes down a folder this machine never vouched for, before git makes it. */
    untrustFolder?(path: string, branch: string): Promise<void>;
}

interface AgentRunOptions {
    provider?: AgentKind;
    onSpawn(kill: () => void): void;
    cwdFor?(folder: string): Promise<string>;
}

/* Streams an action's progress to the client that asked, under the action id it chose. */
function progressTo(client: ClientConnection, cwd: string, actionId: string) {
    return (phase: GitActionPhase, line: string): void => {
        sendEvent(client, 'git.progress', { cwd, actionId, phase, line });
    };
}

export function registerGitHandlers(
    dispatcher: Dispatcher,
    worktrees: Worktrees,
    merges: WorktreeMerge,
    statuses: GitStatusWatcher,
    providers: ProviderRegistry,
    prWatches?: PrWatchStore,
    placeOf?: (id: string) => { projectId: string } | null,
    machineHome?: Pick<MachineHome, 'refuse'>,
    bundleHost?: BundleHost,
    oneShotPlace?: Pick<OneShotPlace, 'cwdFor'>
): void {
    const actions = new GitActions();
    const identities = new IdentityReader();

    dispatcher.register('git.worktree-add', (payload) =>
        worktrees.add(
            payload.repo,
            payload.branch,
            { madeBy: 'client', ...(payload.projectId === undefined ? {} : { projectId: payload.projectId }) },
            payload.base === undefined ? {} : { base: payload.base }
        )
    );

    dispatcher.register('git.worktree-list', async (payload) => ({ worktrees: await worktrees.list(payload.repo, { inspect: payload.inspect === true }) }));

    dispatcher.register('git.worktree-remove', (payload) =>
        worktrees.remove(payload.repo, payload.path, {
            ...(payload.force === undefined ? {} : { force: payload.force }),
            ...(payload.keepBranch === undefined ? {} : { keepBranch: payload.keepBranch }),
            ...(payload.stopAgent === undefined ? {} : { stopAgent: payload.stopAgent })
        })
    );

    dispatcher.register('git.worktree-merge', (payload, client) => merges.merge(payload, progressTo(client, payload.path, payload.actionId)));

    dispatcher.register('git.worktree-abort', async (payload) => {
        await merges.abort(payload.cwd);
        return {};
    });

    dispatcher.register('git.status', (payload) => statuses.status(payload.cwd));

    dispatcher.register('git.watch', async (payload, client) => {
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
        if (payload.scope === 'commit' && payload.path === undefined) {
            return await diffCommit(payload.cwd, payload.commit ?? 'HEAD');
        }
        if (payload.scope === 'base' && payload.path === undefined) {
            return await diffCheckout(payload.cwd, await mergeBaseWith(payload.cwd, payload.base));
        }
        if (payload.path === undefined) {
            throw new RequestError('bad-request', 'A diff of this scope needs a path.');
        }
        const options = {
            scope: payload.scope,
            staged: payload.staged ?? false,
            ignoreWhitespace: payload.ignoreWhitespace ?? false,
            ...(payload.commit ? { commit: payload.commit } : {})
        };
        return await diffFile(payload.cwd, payload.path, options, await mergeBaseWith(payload.cwd, payload.base));
    });

    dispatcher.register('git.blame', (payload) => blameFile(payload.cwd, payload.path));

    dispatcher.register('git.identity', async (payload) => {
        // Judged before any git runs, like the file requests: a client asks about folders, never about the machine's own state.
        await Promise.all(payload.paths.map((path) => machineHome?.refuse(path)));
        return identities.read(payload.paths);
    });

    if (bundleHost !== undefined) {
        const { bundles, checkpoints, folderOf, untrusted, untrustFolder } = bundleHost;

        // A person's handoff is theirs to vouch for, except for work this machine never vouched for itself: that stays so where it goes.
        dispatcher.register('git.bundle', async (payload, client) => {
            await machineHome?.refuse(payload.path);
            const id = crypto.randomUUID();
            bundles.admit(client.id, id);
            const made = await makeBundle(bundles, checkpoints, payload, id).catch(async (error: unknown) => {
                await bundles.discard(id);
                throw error;
            });
            await bundles.keep(made.bundleId, client.id);
            return untrusted?.(payload.path) === true ? { ...made, untrusted: true } : made;
        });

        dispatcher.register('git.bundlePut', async (payload) => ({
            received: await bundles.receive(payload.bundleId, payload.offset, Buffer.from(payload.data, 'base64'), payload.total)
        }));

        dispatcher.register('git.fetchBundle', async (payload) => {
            const folder = await folderOf(payload.projectId);
            if (folder === null) {
                throw new RequestError('project-not-found', `No project ${payload.projectId} is on this machine`);
            }
            return fetchBundle(bundles, worktrees, folder, payload, payload.untrusted === true ? untrustFolder : undefined);
        });
    }

    dispatcher.register('git.stage', async (payload) => {
        await (payload.staged ? stagePaths(payload.cwd, payload.paths) : unstagePaths(payload.cwd, payload.paths));
        return {};
    });

    dispatcher.register('git.discard', (payload) => discardPaths(payload.cwd, payload.paths));

    dispatcher.register('git.refs', (payload) => listRefs(payload.cwd));

    dispatcher.register('git.issue', async (payload) => {
        const ref = parseIssueRef(payload.ref);
        if (ref === null) {
            throw new GitError('issue-not-found', 'Name the issue as a link, owner/repo#12 or #12.');
        }
        return await readIssue(runGh, payload.cwd, ref);
    });

    // The split waits on every page of GitHub's file list, so it is a request of its own and the dialog draws before it.
    dispatcher.register('git.pr', async (payload) => {
        const pr = await readPullRequest(runGh, payload.cwd, payload.number);
        if (pr !== null) {
            prSplits.note(payload.cwd, pr);
        }
        return { pr };
    });

    dispatcher.register('git.prSplit', async (payload) => ({
        split: await prSplits.splitAt(payload.cwd, payload.number, payload.headSha, () => readPullRequest(runGh, payload.cwd, payload.number))
    }));

    const watching = (): PrWatchStore => {
        if (!prWatches) {
            throw new GitError('gh-failed', 'This machine does not watch pull requests');
        }
        return prWatches;
    };
    dispatcher.register('git.pr-watch', async (payload) => {
        // A client names the project and the chat, so the machine checks that the project really holds the chat.
        if (placeOf?.(payload.chatId)?.projectId !== payload.projectId) {
            throw new GitError('pr-watch-refused', 'That chat is not part of this project.');
        }
        return { watch: await watching().start(payload.projectId, payload.chatId, payload.cwd, payload.number) };
    });
    dispatcher.register('git.pr-unwatch', async (payload) => {
        await watching().stop(payload.chatId);
        return {};
    });
    dispatcher.register('git.pr-watches', (payload) => ({ watches: watching().list(payload.projectId) }));

    dispatcher.register('git.ref-commit', (payload) => readRefCommit(payload.cwd, payload.ref));

    dispatcher.register('git.repos', (payload) => cachedRepos(payload.folder, payload.fresh === true));

    dispatcher.register('git.log', (payload) => readLog(payload.cwd, payload.limit, payload.cursor));

    dispatcher.register('git.capabilities', () => readCapabilities(providers));

    /* Progress streams while the git runs; the reply lands after. */
    dispatcher.register('git.action', (payload, client) => actions.run(payload, progressTo(client, payload.cwd, payload.actionId)));

    /*
     * A person's client putting a project on this machine: the folder is judged like a file request's
     * path, before git makes it. Not on a peer's list, and no agent reaches it.
     */
    dispatcher.register('git.clone', async (payload, client) => {
        await Promise.all([machineHome?.refuse(payload.path), machineHome?.refuse(dirname(payload.path))]);
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
        await machineHome?.refuse(payload.cwd);
        return listIgnoredFiles(payload.cwd);
    });

    dispatcher.register('git.cancel', (payload) => {
        actions.cancel(payload.actionId);
        merges.cancel(payload.actionId);
        return {};
    });

    dispatcher.register('git.conflicts', (payload) => readConflicts(payload.cwd));

    dispatcher.register('git.conflict', (payload) => readConflict(payload.cwd, payload.path));

    dispatcher.register('git.resolve', async (payload) => ({ remaining: await resolveConflict(payload) }));

    dispatcher.register('git.operation', (payload, client) =>
        runOperation(payload.cwd, payload.action, payload.actionId, progressTo(client, payload.cwd, payload.actionId))
    );

    /* An agent CLI behind a cancellable action: `git.cancel` with its id kills what it spawned. */
    const runAgent = async <T>(actionId: string, provider: AgentKind | undefined, run: (options: AgentRunOptions) => Promise<T>): Promise<T> => {
        const job = actions.claim(actionId);
        try {
            return await run({
                ...(provider ? { provider } : {}),
                ...(oneShotPlace ? { cwdFor: (folder: string) => oneShotPlace.cwdFor(folder) } : {}),
                onSpawn: (kill) => job.hold(kill)
            });
        } finally {
            job.release();
        }
    };

    dispatcher.register('git.resolveAi', (payload) =>
        runAgent(payload.actionId, payload.provider, async (options) =>
            resolveWithAgent(payload.cwd, payload.path, await readConflicts(payload.cwd), providers, options)
        )
    );

    dispatcher.register('git.suggestMessage', (payload) =>
        runAgent(payload.actionId, payload.provider, (options) => suggestMessage(payload.cwd, providers, options))
    );
}
