import { worktreeActions } from '../actions/worktree-actions.ts';
import { worktreeHost } from '../git/worktree-host.ts';
import { worktreeToolkit } from '../tools/worktree-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const worktreeFeature = defineAgentFeature({
    name: 'worktree',
    toolkit: worktreeToolkit,
    actions: worktreeActions,
    host: ({ git }) => ({ worktrees: worktreeHost(git.worktrees, git.merges) })
});
