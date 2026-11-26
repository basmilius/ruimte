import { PictureInPicture2, Undo2 } from 'lucide-react';
import type { CommandSpec } from '@/commands/types';
import { auxWindowId } from '@/state/window-target';

export const VIEW_WINDOW_COMMANDS = {
    'view-window-new': {
        key: 'moveViewToNewWindow',
        icon: PictureInPicture2,
        palette: true,
        menu: { menu: 'file', group: 'close', order: 12, when: (context) => context.workspace && context.windows && context.cells > 0 }
    },
    'view-window-main': {
        key: 'moveViewToMainWindow',
        icon: Undo2,
        palette: true,
        menu: { menu: 'file', group: 'close', order: 14, when: (context) => context.workspace && context.windows && auxWindowId() !== null }
    }
} as const satisfies Record<string, CommandSpec>;
