import { Clock, CalendarPlus } from 'lucide-react';
import { type CommandSpec } from '@/commands/types';
import { CANVAS_SHORTCUTS } from '@/surface/canvas/shortcuts';

export const ROUTINE_COMMANDS = {
    routines: {
        key: 'routines',
        icon: Clock,
        shortcut: CANVAS_SHORTCUTS.routines,
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
