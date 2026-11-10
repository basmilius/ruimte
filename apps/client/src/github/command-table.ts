import { CircleDot, EyeOff, GitPullRequest } from 'lucide-react';
import { worktreeChat } from '@/commands/conditions';
import { type CommandSpec } from '@/commands/types';

export const GITHUB_COMMANDS = {
    'pr-show': {
        key: 'showPullRequest',
        icon: GitPullRequest,
        palette: true,
        menu: { menu: 'code', group: 'pull-request', order: 20, when: (context) => context.prRepos.length <= 1 }
    },
    'pr-watch-stop': {
        key: 'stopPrWatch',
        icon: EyeOff,
        palette: true,
        menu: { menu: 'code', group: 'pr-watch', order: 10, when: (context) => context.prWatch }
    },
    'issue-start': { key: 'startFromIssue', icon: CircleDot, palette: true, menu: { menu: 'file', group: 'new', order: 40, when: worktreeChat } }
} satisfies Record<string, CommandSpec>;
