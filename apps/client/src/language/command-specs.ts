import type { CommandSpec, MenuPlace } from '@/commands/types';
import { LANGUAGE_COMMAND_IDS, LANGUAGE_COMMANDS, type LanguageCommandId } from '@/language/command-table';
import { EDITOR_COMMAND_IDS, EDITOR_COMMANDS, type EditorCommandGroup, type EditorCommandId } from '@/language/editor-commands';

function languageCommand(id: LanguageCommandId): CommandSpec {
    const spec = LANGUAGE_COMMANDS[id];

    return {
        key: spec.key,
        icon: spec.icon,
        ...(spec.shortcut ? { shortcut: spec.shortcut } : {}),
        palette: true,
        menu: {
            menu: spec.menu,
            group: spec.group ?? 'language',
            order: LANGUAGE_COMMAND_IDS.indexOf(id),
            ...(spec.menu === 'go' ? { enabled: (context) => context.languageAvailable } : {})
        }
    };
}

function editorMenuPlace(group: EditorCommandGroup | undefined, order: number): MenuPlace {
    switch (group) {
        case 'folding':
            return { menu: 'folding', group: 'folding', order };
        case 'lines':
            return { menu: 'edit', group: 'lines', order };
        case 'clipboard':
            return { menu: 'edit', group: 'clipboard', order };
        case 'navigate':
            return { menu: 'go', group: 'editor-navigation', order, enabled: (context) => context.editorAvailable };
        case 'zoom':
            return { menu: 'view', group: 'code-zoom', order };
        default:
            return { menu: 'code', group: 'editor', order };
    }
}

function editorCommand(id: EditorCommandId): CommandSpec {
    const spec = EDITOR_COMMANDS[id];

    return {
        key: spec.key,
        icon: spec.icon,
        ...(spec.shortcut ? { shortcut: spec.shortcut } : {}),
        palette: true,
        menu: editorMenuPlace(spec.group, EDITOR_COMMAND_IDS.indexOf(id))
    };
}

/* The language and editing commands as rows of the command table; what they do is in `language-commands.ts` and `editor-commands.ts`. */
export const LANGUAGE_AND_EDITOR_COMMANDS: Readonly<Record<string, CommandSpec>> = {
    ...Object.fromEntries(LANGUAGE_COMMAND_IDS.map((id) => [id, languageCommand(id)])),
    ...Object.fromEntries(EDITOR_COMMAND_IDS.map((id) => [id, editorCommand(id)]))
};
