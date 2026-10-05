import type { Shortcut } from '@basmilius/desktop-ui';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';

/*
 * The commands that act on the editor with the keyboard in it: the id the menu and the palette share, the
 * key of its words (`shell:menu.<key>` and `shell:palette.commands.<key>`) and its shortcut. What each one does
 * is in `language-commands.ts`, so a menu can list them without loading an editor.
 */
interface LanguageCommandSpec {
    readonly menu: 'code' | 'go';
    readonly key: string;
    readonly shortcut?: Shortcut;
}

const TABLE = {
    'trigger-completion': { menu: 'code', key: 'triggerCompletion', shortcut: CANVAS_SHORTCUTS.triggerCompletion },
    'parameter-info': { menu: 'code', key: 'parameterInfo', shortcut: CANVAS_SHORTCUTS.parameterInfo },
    'quick-info': { menu: 'code', key: 'quickInfo', shortcut: CANVAS_SHORTCUTS.quickInfo },
    'code-actions': { menu: 'code', key: 'codeActions', shortcut: CANVAS_SHORTCUTS.codeActions },
    'rename-symbol': { menu: 'code', key: 'renameSymbol', shortcut: CANVAS_SHORTCUTS.rename },
    'organize-imports': { menu: 'code', key: 'organizeImports', shortcut: CANVAS_SHORTCUTS.organizeImports },
    'format-document': { menu: 'code', key: 'formatDocument', shortcut: CANVAS_SHORTCUTS.formatDocument },
    'selection-to-chat': { menu: 'code', key: 'selectionToChat', shortcut: CANVAS_SHORTCUTS.selectionToChat },
    'inline-edit': { menu: 'code', key: 'inlineEdit', shortcut: CANVAS_SHORTCUTS.inlineEdit },
    'show-inline-edit': { menu: 'code', key: 'showInlineEdit' },
    'go-to-symbol': { menu: 'go', key: 'goToSymbol', shortcut: CANVAS_SHORTCUTS.goToSymbol },
    'go-to-definition': { menu: 'go', key: 'goToDefinition', shortcut: CANVAS_SHORTCUTS.goToDefinition },
    'go-to-declaration': { menu: 'go', key: 'goToDeclaration' },
    'go-to-type-definition': { menu: 'go', key: 'goToTypeDefinition', shortcut: CANVAS_SHORTCUTS.goToTypeDefinition },
    'peek-definition': { menu: 'go', key: 'peekDefinition', shortcut: CANVAS_SHORTCUTS.peekDefinition },
    'peek-references': { menu: 'go', key: 'peekReferences', shortcut: CANVAS_SHORTCUTS.peekReferences },
    'go-to-implementation': { menu: 'go', key: 'goToImplementation', shortcut: CANVAS_SHORTCUTS.goToImplementation },
    'history-back': { menu: 'go', key: 'historyBack', shortcut: CANVAS_SHORTCUTS.historyBack },
    'history-forward': { menu: 'go', key: 'historyForward', shortcut: CANVAS_SHORTCUTS.historyForward },
    'recent-locations': { menu: 'go', key: 'recentLocations', shortcut: CANVAS_SHORTCUTS.recentLocations }
} satisfies Record<string, LanguageCommandSpec>;

export type LanguageCommandId = keyof typeof TABLE;

export const LANGUAGE_COMMANDS: Record<LanguageCommandId, LanguageCommandSpec> = TABLE;

export const LANGUAGE_COMMAND_IDS = Object.keys(LANGUAGE_COMMANDS) as LanguageCommandId[];

/* The ids of one menu, in the order the table lists them. */
export function languageCommandsOf(menu: 'code' | 'go'): LanguageCommandId[] {
    return LANGUAGE_COMMAND_IDS.filter((id) => LANGUAGE_COMMANDS[id].menu === menu);
}
