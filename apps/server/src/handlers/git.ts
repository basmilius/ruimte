import { RequestError, type Dispatcher } from '../dispatcher.ts';
import { GitError, type Worktrees } from '../git/worktrees.ts';

const translate = <T>(work: () => T | Promise<T>): Promise<T> =>
    Promise.resolve()
        .then(work)
        .catch((e: unknown) => {
            if (e instanceof GitError) {
                throw new RequestError(e.code, e.message);
            }
            throw e;
        });

export const registerGitHandlers = (dispatcher: Dispatcher, worktrees: Worktrees): void => {
    dispatcher.register('git.worktree-add', (payload) => translate(() => worktrees.add(payload.repo, payload.branch)));

    dispatcher.register('git.worktree-list', (payload) => translate(async () => ({ worktrees: await worktrees.list(payload.repo) })));

    dispatcher.register('git.worktree-remove', (payload) =>
        translate(async () => {
            await worktrees.remove(payload.repo, payload.path);
            return {};
        })
    );
};
