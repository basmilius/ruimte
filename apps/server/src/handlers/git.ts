import { RequestError, type Dispatcher } from '../dispatcher.ts';
import { diffFile } from '../git/diff.ts';
import { GitError } from '../git/run.ts';
import { discardPaths, stagePaths, unstagePaths } from '../git/stage.ts';
import type { GitStatusWatcher } from '../git/status-watcher.ts';
import { mergeBaseOf } from '../git/status.ts';
import type { Worktrees } from '../git/worktrees.ts';

const translate = <T>(work: () => T | Promise<T>): Promise<T> =>
    Promise.resolve()
        .then(work)
        .catch((e: unknown) => {
            if (e instanceof GitError) {
                throw new RequestError(e.code, e.message);
            }
            throw e;
        });

export const registerGitHandlers = (dispatcher: Dispatcher, worktrees: Worktrees, statuses: GitStatusWatcher): void => {
    dispatcher.register('git.worktree-add', (payload) => translate(() => worktrees.add(payload.repo, payload.branch)));

    dispatcher.register('git.worktree-list', (payload) => translate(async () => ({ worktrees: await worktrees.list(payload.repo) })));

    dispatcher.register('git.worktree-remove', (payload) =>
        translate(async () => {
            await worktrees.remove(payload.repo, payload.path);
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
        translate(async () => diffFile(payload.cwd, payload.path, payload.scope, payload.staged ?? false, await mergeBaseOf(payload.cwd)))
    );

    dispatcher.register('git.stage', (payload) =>
        translate(async () => {
            await (payload.staged ? stagePaths(payload.cwd, payload.paths) : unstagePaths(payload.cwd, payload.paths));
            return {};
        })
    );

    dispatcher.register('git.discard', (payload) => translate(() => discardPaths(payload.cwd, payload.paths)));
};
