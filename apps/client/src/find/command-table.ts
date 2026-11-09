import { ArrowDown, ArrowUp, Replace, TextSearch } from 'lucide-react';
import { type CommandSpec } from '@/commands/types';
import { keyOf } from '@/surface/shortcut-overrides';
import { platformShortcut, TERMINAL_FIND_SHORTCUT } from '@/surface/terminal-keymap';

export const FIND_COMMANDS = {
    find: {
        key: 'find',
        icon: TextSearch,
        binds: 'workspace',
        palette: true,
        // A focused terminal answers its own find key (`terminal/xterm.ts`), which is not the window's off macOS; one without a find bar answers none.
        menu: {
            menu: 'edit',
            group: 'find',
            order: 10,
            shortcut: (context) => {
                if (!context.terminalKeys) {
                    return keyOf('find');
                }
                return context.terminalFind ? platformShortcut(TERMINAL_FIND_SHORTCUT, context.apple) : undefined;
            }
        }
    },
    'find-replace': {
        key: 'findReplace',
        icon: Replace,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'edit', group: 'find', order: 20 }
    },
    // The menu shows no key: its group command holds Cmd+G, and the editor answers the key itself.
    'find-next': {
        key: 'findNext',
        icon: ArrowDown,
        keymap: 'findNext',
        palette: true,
        menu: { menu: 'edit', group: 'find', order: 30, showsShortcut: () => false }
    },
    'find-previous': {
        key: 'findPrevious',
        icon: ArrowUp,
        keymap: 'findPrevious',
        palette: true,
        menu: { menu: 'edit', group: 'find', order: 40, showsShortcut: () => false }
    },
    'next-problem': {
        key: 'nextProblem',
        icon: ArrowDown,
        keymap: 'nextProblem',
        palette: true,
        menu: { menu: 'edit', group: 'problems', order: 10 }
    },
    'previous-problem': {
        key: 'previousProblem',
        icon: ArrowUp,
        keymap: 'previousProblem',
        palette: true,
        menu: { menu: 'edit', group: 'problems', order: 20 }
    },
    'next-highlight': {
        key: 'nextHighlight',
        icon: ArrowDown,
        keymap: 'nextHighlight',
        palette: true,
        menu: { menu: 'edit', group: 'problems', order: 30 }
    },
    'previous-highlight': {
        key: 'previousHighlight',
        icon: ArrowUp,
        keymap: 'previousHighlight',
        palette: true,
        menu: { menu: 'edit', group: 'problems', order: 40 }
    }
} satisfies Record<string, CommandSpec>;
