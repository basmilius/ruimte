import { TabletSmartphone } from 'lucide-react';
import { type CommandSpec } from '@/commands/types';

export const DEVICE_COMMANDS = {
    'panel-devices': {
        key: 'devices',
        icon: TabletSmartphone,
        palette: false,
        menu: { menu: 'view', group: 'panels', order: 40, when: (context) => !context.scratch, checked: (context) => context.panel === 'devices' }
    }
} satisfies Record<string, CommandSpec>;
