import { Package } from 'lucide-react';
import { type CommandSpec } from '@/commands/types';

export const OUTPUT_COMMANDS = {
    'panel-output': {
        key: 'toggleOutput',
        icon: Package,
        palette: true,
        menu: { menu: 'view', group: 'panels', order: 25, checked: (context) => context.panel === 'output' }
    }
} satisfies Record<string, CommandSpec>;
