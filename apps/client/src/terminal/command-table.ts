import { Eraser } from 'lucide-react';
import { type CommandSpec } from '@/commands/types';
import { CLEAR_SHORTCUT, platformShortcut } from '@/surface/terminal-keymap';

export const TERMINAL_COMMANDS = {
    // The terminal's own key handler answers the key (`terminal/xterm.ts`), so the row shows it only while a terminal has the keyboard.
    'terminal-clear': {
        key: 'clear',
        icon: Eraser,
        palette: false,
        menu: {
            menu: 'kind',
            group: 'terminal',
            order: 10,
            shortcut: (context) => (context.terminalKeys ? platformShortcut(CLEAR_SHORTCUT, context.apple) : undefined)
        }
    }
} satisfies Record<string, CommandSpec>;
