import { Activity } from 'lucide-react';
import { type CommandSpec } from '@/commands/types';

export const PROCESS_COMMANDS = {
    'panel-processes': {
        key: 'toggleProcesses',
        icon: Activity,
        palette: true,
        menu: { menu: 'view', group: 'panels', order: 42, when: (context) => context.workspace, checked: (context) => context.panel === 'processes' }
    }
} satisfies Record<string, CommandSpec>;
