import { ArrowDown, ArrowUp, Replace, TextSearch } from 'lucide-react';
import { type CommandSpec } from '@/commands/types';
import { CANVAS_SHORTCUTS } from '@/surface/canvas/shortcuts';
import { editorShortcut } from '@/surface/editor-keymap';
import { platformShortcut, TERMINAL_FIND_SHORTCUT } from '@/surface/terminal-keymap';

export const FIND_COMMANDS = {
    find: {
        key: 'find',
        icon: TextSearch,
        shortcut: CANVAS_SHORTCUTS.find,
        binds: 'workspace',
        palette: true,
        // A focused terminal answers its own find key (`terminal/xterm.ts`), which is not the window's off macOS; one without a find bar answers none.
        menu: {
            menu: 'edit',
            group: 'find',
            order: 10,
            shortcut: (context) => {
                if (!context.terminalKeys) {
                    return CANVAS_SHORTCUTS.find;
                }
                return context.terminalFind ? platformShortcut(TERMINAL_FIND_SHORTCUT, context.apple) : undefined;
            }
        }
    },
    'find-replace': {
        key: 'findReplace',
        icon: Replace,
        shortcut: CANVAS_SHORTCUTS.findReplace,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'edit', group: 'find', order: 20 }
    },
    // The menu shows no key: its group command holds Cmd+G, and the editor answers the key itself.
    'find-next': {
        key: 'findNext',
        icon: ArrowDown,
        shortcut: editorShortcut('findNext'),
        palette: true,
        menu: { menu: 'edit', group: 'find', order: 30, showsShortcut: () => false }
    },
    'find-previous': {
        key: 'findPrevious',
        icon: ArrowUp,
        shortcut: editorShortcut('findPrevious'),
        palette: true,
        menu: { menu: 'edit', group: 'find', order: 40, showsShortcut: () => false }
    },
    'next-problem': {
        key: 'nextProblem',
        icon: ArrowDown,
        shortcut: CANVAS_SHORTCUTS.nextProblem,
        palette: true,
        menu: { menu: 'edit', group: 'problems', order: 10 }
    },
    'previous-problem': {
        key: 'previousProblem',
        icon: ArrowUp,
        shortcut: CANVAS_SHORTCUTS.previousProblem,
        palette: true,
        menu: { menu: 'edit', group: 'problems', order: 20 }
    },
    'next-highlight': {
        key: 'nextHighlight',
        icon: ArrowDown,
        shortcut: CANVAS_SHORTCUTS.nextHighlight,
        palette: true,
        menu: { menu: 'edit', group: 'problems', order: 30 }
    },
    'previous-highlight': {
        key: 'previousHighlight',
        icon: ArrowUp,
        shortcut: CANVAS_SHORTCUTS.previousHighlight,
        palette: true,
        menu: { menu: 'edit', group: 'problems', order: 40 }
    }
} satisfies Record<string, CommandSpec>;
