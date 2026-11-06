import { Activity } from 'lucide-react';
import { type CommandSpec } from '@/commands/types';

export const PROCESS_COMMANDS = {
    'panel-processes': {
        key: 'toggleProcesses',
        icon: Activity,
        palette: true,
        menu: { menu: 'window', group: 'panels', order: 10, when: (context) => context.workspace, checked: (context) => context.panel === 'processes' }
    }
} satisfies Record<string, CommandSpec>;
