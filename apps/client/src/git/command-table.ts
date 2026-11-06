import { GitBranch } from 'lucide-react';
import { type CommandSpec } from '@/commands/types';

export const GIT_COMMANDS = {
    'panel-git': {
        key: 'toggleGit',
        icon: GitBranch,
        palette: true,
        menu: { menu: 'view', group: 'panels', order: 20, when: (context) => !context.scratch, checked: (context) => context.panel === 'git' }
    }
} satisfies Record<string, CommandSpec>;
