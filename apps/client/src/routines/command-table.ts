import { Clock, CalendarPlus } from 'lucide-react';
import { type CommandSpec } from '@/commands/types';

export const ROUTINE_COMMANDS = {
    routines: {
        key: 'routines',
        icon: Clock,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'view', group: 'panels', order: 45, when: (context) => context.routines }
    },
    'routine-new': {
        key: 'newRoutine',
        icon: CalendarPlus,
        palette: true,
        menu: { menu: 'file', group: 'new', order: 50, when: (context) => context.routines }
    }
} satisfies Record<string, CommandSpec>;
