import { CircleAlert } from 'lucide-react';
import { type CommandSpec } from '@/commands/types';

export const PROBLEMS_COMMANDS = {
    'panel-problems': {
        key: 'toggleProblems',
        icon: CircleAlert,
        palette: true,
        menu: {
            menu: 'window',
            group: 'panels',
            order: 20,
            when: (context) => context.workspace && !context.scratch,
            checked: (context) => context.panel === 'problems'
        }
    }
} satisfies Record<string, CommandSpec>;
