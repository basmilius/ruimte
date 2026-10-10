import type { AgentKind, GitActionPhase } from '@ruimte/contracts';
import { RequestError, sendEvent, translate, type ClientConnection, type Dispatcher } from '../dispatcher.ts';
import { GitActions } from '../git/actions.ts';
import { blameFile } from '../git/blame.ts';
import { readCapabilities } from '../git/capabilities.ts';
import { readConflict, readConflicts, resolveConflict, runOperation } from '../git/conflict.ts';
import { resolveWithAgent } from '../git/resolve-ai.ts';
import { diffCheckout, diffCommit, diffFile } from '../git/diff.ts';
import { readLog } from '../git/log.ts';
import { suggestMessage } from '../git/message.ts';
import { listRefs } from '../git/refs.ts';
import { listRepos } from '../git/repos.ts';
import { discardPaths, stagePaths, unstagePaths } from '../git/stage.ts';
import type { GitStatusWatcher } from '../git/status-watcher.ts';
import { mergeBaseWith } from '../git/status.ts';
import type { WorktreeMerge } from '../git/worktree-merge.ts';
import type { Worktrees } from '../git/worktrees.ts';
import type { ProviderRegistry } from '../providers/registry.ts';

interface AgentRunOptions {
    provider?: AgentKind;
    onSpawn(kill: () => void): void;
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
    providers: ProviderRegistry
): void {
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

    dispatcher.register('git.worktree-merge', (payload, client) => translate(() => merges.merge(payload, progressTo(client, payload.path, payload.actionId))));

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
            if (client.closed) {
                statuses.detachAll(client.id);
            }
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

    dispatcher.register('git.blame', (payload) => translate(() => blameFile(payload.cwd, payload.path)));

    dispatcher.register('git.stage', (payload) =>
        translate(async () => {
            await (payload.staged ? stagePaths(payload.cwd, payload.paths) : unstagePaths(payload.cwd, payload.paths));
            return {};
        })
    );

    dispatcher.register('git.discard', (payload) => translate(() => discardPaths(payload.cwd, payload.paths)));

    dispatcher.register('git.refs', (payload) => translate(() => listRefs(payload.cwd)));

    dispatcher.register('git.repos', (payload) => translate(() => listRepos(payload.folder)));

    dispatcher.register('git.log', (payload) => translate(() => readLog(payload.cwd, payload.limit, payload.cursor)));

    dispatcher.register('git.capabilities', () => translate(() => readCapabilities(providers)));

    /* Progress streams while the git runs; the reply lands after. */
    dispatcher.register('git.action', (payload, client) => translate(() => actions.run(payload, progressTo(client, payload.cwd, payload.actionId))));

    dispatcher.register('git.cancel', (payload) => {
        actions.cancel(payload.actionId);
        merges.cancel(payload.actionId);
        return {};
    });

    dispatcher.register('git.conflicts', (payload) => translate(() => readConflicts(payload.cwd)));

    dispatcher.register('git.conflict', (payload) => translate(() => readConflict(payload.cwd, payload.path)));

    dispatcher.register('git.resolve', (payload) => translate(async () => ({ remaining: await resolveConflict(payload) })));

    dispatcher.register('git.operation', (payload, client) =>
        translate(() => runOperation(payload.cwd, payload.action, payload.actionId, progressTo(client, payload.cwd, payload.actionId)))
    );

    /* An agent CLI behind a cancellable action: `git.cancel` with its id kills what it spawned. */
    const runAgent = async <T>(actionId: string, provider: AgentKind | undefined, run: (options: AgentRunOptions) => Promise<T>): Promise<T> => {
        const job = actions.claim(actionId);
        try {
            return await run({ ...(provider ? { provider } : {}), onSpawn: (kill) => job.hold(kill) });
        } finally {
            job.release();
        }
    };

    dispatcher.register('git.resolveAi', (payload) =>
        translate(() =>
            runAgent(payload.actionId, payload.provider, async (options) =>
                resolveWithAgent(payload.cwd, payload.path, await readConflicts(payload.cwd), providers, options)
            )
        )
    );

    dispatcher.register('git.suggestMessage', (payload) =>
        translate(() => runAgent(payload.actionId, payload.provider, (options) => suggestMessage(payload.cwd, providers, options)))
    );
}
