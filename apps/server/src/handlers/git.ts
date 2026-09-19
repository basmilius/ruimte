import { RequestError, sendEvent, translate, type Dispatcher } from '../dispatcher.ts';
import { GitActions } from '../git/actions.ts';
import { readCapabilities } from '../git/capabilities.ts';
import { diffCheckout, diffCommit, diffFile } from '../git/diff.ts';
import { readLog } from '../git/log.ts';
import { suggestMessage } from '../git/message.ts';
import { listRefs } from '../git/refs.ts';
import { discardPaths, stagePaths, unstagePaths } from '../git/stage.ts';
import type { GitStatusWatcher } from '../git/status-watcher.ts';
import { mergeBaseWith } from '../git/status.ts';
import type { WorktreeMerge } from '../git/worktree-merge.ts';
import type { Worktrees } from '../git/worktrees.ts';
import type { ProviderRegistry } from '../providers/registry.ts';

export const registerGitHandlers = (
    dispatcher: Dispatcher,
    worktrees: Worktrees,
    merges: WorktreeMerge,
    statuses: GitStatusWatcher,
    providers: ProviderRegistry
): void => {
    const actions = new GitActions();

    dispatcher.register('git.worktree-add', (payload) =>
        translate(() =>
            worktrees.add(payload.repo, payload.branch, { madeBy: 'client', ...(payload.projectId === undefined ? {} : { projectId: payload.projectId }) })
        )
    );

    dispatcher.register('git.worktree-list', (payload) =>
        translate(async () => ({ worktrees: await worktrees.list(payload.repo, { inspect: payload.inspect === true }) }))
    );

    dispatcher.register('git.worktree-remove', (payload) =>
        translate(() =>
            worktrees.remove(payload.repo, payload.path, {
                ...(payload.force === undefined ? {} : { force: payload.force }),
                ...(payload.keepBranch === undefined ? {} : { keepBranch: payload.keepBranch })
            })
        )
    );

    /* Progress goes to the client that asked, under the action id it chose, the way `git.action` streams. */
    dispatcher.register('git.worktree-merge', (payload, client) =>
        translate(() =>
            merges.merge(payload, (phase, line) => {
                sendEvent(client, 'git.progress', { cwd: payload.path, actionId: payload.actionId, phase, line });
            })
        )
    );

    dispatcher.register('git.worktree-abort', (payload) =>
        translate(async () => {
            await merges.abort(payload.cwd);
            return {};
        })
    );

    dispatcher.register('git.status', (payload) => translate(() => statuses.status(payload.cwd)));

    dispatcher.register('git.watch', (payload, client) =>
        translate(async () => {
            await statuses.watch(client.id, payload.cwd);
            return {};
        })
    );

    dispatcher.register('git.unwatch', (payload, client) => {
        statuses.unwatch(client.id, payload.cwd);
        return {};
    });

    dispatcher.register('git.diff', (payload) =>
        translate(async () => {
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
        })
    );

    dispatcher.register('git.stage', (payload) =>
        translate(async () => {
            await (payload.staged ? stagePaths(payload.cwd, payload.paths) : unstagePaths(payload.cwd, payload.paths));
            return {};
        })
    );

    dispatcher.register('git.discard', (payload) => translate(() => discardPaths(payload.cwd, payload.paths)));

    dispatcher.register('git.refs', (payload) => translate(() => listRefs(payload.cwd)));

    dispatcher.register('git.log', (payload) => translate(() => readLog(payload.cwd, payload.limit, payload.cursor)));

    dispatcher.register('git.capabilities', () => translate(() => readCapabilities(providers)));

    /* Progress goes to the client that asked, while the git it asked for runs; the reply lands after. */
    dispatcher.register('git.action', (payload, client) =>
        translate(() =>
            actions.run(payload, (phase, line) => {
                sendEvent(client, 'git.progress', { cwd: payload.cwd, actionId: payload.actionId, phase, line });
            })
        )
    );

    dispatcher.register('git.cancel', (payload) => {
        actions.cancel(payload.actionId);
        merges.cancel(payload.actionId);
        return {};
    });

    dispatcher.register('git.suggestMessage', (payload) =>
        translate(async () => {
            const job = actions.claim(payload.actionId);
            try {
                return await suggestMessage(payload.cwd, providers, {
                    ...(payload.provider ? { provider: payload.provider } : {}),
                    onSpawn: (kill) => job.hold(kill)
                });
            } finally {
                job.release();
            }
        })
    );
};
