import { CornerUpRight, FileText, FilePlus, Folder, FolderPlus, Search } from 'lucide-react';
import { type CommandSpec } from '@/commands/types';
import { editorShortcut } from '@/surface/editor-keymap';
import { APP_SHORTCUTS } from '@/surface/shortcuts';

export const FILE_COMMANDS = {
    'file-new': {
        key: 'newFile',
        icon: FilePlus,
        palette: true,
        menu: { menu: 'file', group: 'open', order: 30, when: (context) => context.workspace && context.folder }
    },
    'folder-new': {
        key: 'newFolder',
        icon: FolderPlus,
        palette: true,
        menu: { menu: 'file', group: 'open', order: 40, when: (context) => context.workspace && context.folder }
    },
    reveal: {
        key: 'reveal',
        icon: CornerUpRight,
        palette: true,
        menu: {
            menu: 'file',
            group: 'open',
            order: 60,
            when: (context) => context.workspace && context.folder,
            words: (context) => ({ key: 'reveal', values: { app: context.fileManager } })
        }
    },
    // A diff answers the key on its own editors (`files/diff-caret.ts`), since a file's editor gives it to Text End.
    'open-file-at-line': {
        key: 'jumpToSource',
        icon: FileText,
        shortcut: editorShortcut('jumpToSource'),
        palette: true,
        menu: { menu: 'go', group: 'editor-navigation', order: 100, enabled: (context) => context.diff }
    },
    'panel-files': {
        key: 'toggleFiles',
        icon: Folder,
        palette: true,
        menu: { menu: 'view', group: 'panels', order: 10, when: (context) => !context.scratch, checked: (context) => context.panel === 'files' }
    },
    'find-in-files': {
        key: 'findInFiles',
        icon: Search,
        shortcut: APP_SHORTCUTS.findInFiles,
        binds: 'window',
        palette: true,
        // Off macOS a focused terminal keeps Ctrl+Shift+F for its own find (`TERMINAL_FIND_SHORTCUT`).
        menu: {
            menu: 'edit',
            group: 'search',
            order: 20,
            when: (context) => context.workspace && context.folder,
            showsShortcut: (context) => context.apple || !context.terminalKeys
        }
    }
} satisfies Record<string, CommandSpec>;
