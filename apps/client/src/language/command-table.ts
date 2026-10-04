import type { Shortcut } from '@basmilius/desktop-ui';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';

/*
 * The commands that act on the editor with the keyboard in it: the id the menu and the palette share, the
 * key of its words (`shell:menu.<key>` and `shell:palette.commands.<key>`) and its shortcut. What each one does
 * is in `language-commands.ts`, so a menu can list them without loading an editor.
 */
export const LANGUAGE_COMMANDS = {
    'code-actions': { key: 'codeActions', shortcut: CANVAS_SHORTCUTS.codeActions },
    'rename-symbol': { key: 'renameSymbol', shortcut: CANVAS_SHORTCUTS.rename },
    'organize-imports': { key: 'organizeImports', shortcut: CANVAS_SHORTCUTS.organizeImports },
    'format-document': { key: 'formatDocument', shortcut: CANVAS_SHORTCUTS.formatDocument }
} as const satisfies Record<string, { key: string; shortcut?: Shortcut }>;

export type LanguageCommandId = keyof typeof LANGUAGE_COMMANDS;

export const LANGUAGE_COMMAND_IDS = Object.keys(LANGUAGE_COMMANDS) as LanguageCommandId[];
