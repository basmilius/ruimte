import { GitBranch, GitCompare } from 'lucide-react';
import { type CommandSpec } from '@/commands/types';

export const GIT_COMMANDS = {
    'panel-git': {
        key: 'toggleGit',
        icon: GitBranch,
        palette: true,
        menu: { menu: 'view', group: 'panels', order: 20, when: (context) => !context.scratch, checked: (context) => context.panel === 'git' }
    },
    'git-compare-branches': {
        key: 'compareBranches',
        icon: GitCompare,
        palette: true,
        menu: { menu: 'view', group: 'panels', order: 21, when: (context) => !context.scratch }
    }
} satisfies Record<string, CommandSpec>;
