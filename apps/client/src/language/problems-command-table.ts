import { CircleAlert } from 'lucide-react';
import { type CommandSpec } from '@/commands/types';

export const PROBLEMS_COMMANDS = {
    'panel-problems': {
        key: 'toggleProblems',
        icon: CircleAlert,
        palette: true,
        menu: {
            menu: 'view',
            group: 'panels',
            order: 44,
            when: (context) => context.workspace && !context.scratch,
            checked: (context) => context.panel === 'problems'
        }
    }
} satisfies Record<string, CommandSpec>;
