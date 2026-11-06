import { worktreeActions } from '../actions/worktree-actions.ts';
import { worktreeHost, type WorktreeHost } from '../git/worktree-host.ts';
import { worktreeToolkit } from '../tools/worktree-tools.ts';
import { defineAgentFeature } from './feature.ts';

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* Reading and merging the worktrees of the project's repository; a host without git has none. */
        worktrees?: WorktreeHost;
    }
}

export const worktreeFeature = defineAgentFeature({
    name: 'worktree',
    toolkit: worktreeToolkit,
    actions: worktreeActions,
    host: ({ git }) => ({ worktrees: worktreeHost(git.worktrees, git.merges) })
});
