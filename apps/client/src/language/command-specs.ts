import { editorAvailable } from '@/commands/conditions';
import type { CommandSpec, MenuPlace } from '@/commands/types';
import { LANGUAGE_COMMAND_IDS, LANGUAGE_COMMANDS, type LanguageCommandId } from '@/language/command-table';
import { EDITOR_COMMAND_IDS, EDITOR_COMMANDS, type EditorCommandGroup, type EditorCommandId } from '@/language/editor-commands';

function languageCommand(id: LanguageCommandId): CommandSpec {
    const spec = LANGUAGE_COMMANDS[id];

    return {
        key: spec.key,
        icon: spec.icon,
        ...(spec.keymap ? { keymap: spec.keymap } : {}),
        palette: true,
        // Only an editor answers these, so the menu leaves them out until one, or its language, has the keyboard.
        menu: {
            menu: spec.menu,
            group: spec.group ?? 'language',
            order: LANGUAGE_COMMAND_IDS.indexOf(id),
            when: (context) => context.editorAvailable || context.languageAvailable,
            ...(spec.menu === 'go' ? { enabled: (context) => context.languageAvailable } : {})
        }
    };
}

function editorMenuPlace(group: EditorCommandGroup | undefined, order: number): Omit<MenuPlace, 'when'> {
    switch (group) {
        case 'completion':
            return { menu: 'completion', group: 'completion', order };
        case 'folding':
            return { menu: 'folding', group: 'folding', order };
        case 'level':
            return { menu: 'expand-to-level', group: 'levels', order };
        case 'lines':
            return { menu: 'edit', group: 'lines', order };
        case 'clipboard':
            return { menu: 'edit', group: 'clipboard', order };
        case 'navigate':
            return { menu: 'go', group: 'editor-navigation', order };
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
        keymap: spec.keymap,
        palette: true,
        menu: {
            ...editorMenuPlace(spec.group, EDITOR_COMMAND_IDS.indexOf(id)),
            when: editorAvailable,
            ...(spec.level === undefined ? {} : { words: () => ({ key: 'foldingLevel', values: { level: String(spec.level) } }) })
        }
    };
}

/* The language and editing commands as rows of the command table; what they do is in `language-commands.ts` and `editor-commands.ts`. */
export const LANGUAGE_AND_EDITOR_COMMANDS: Readonly<Record<string, CommandSpec>> = {
    ...Object.fromEntries(LANGUAGE_COMMAND_IDS.map((id) => [id, languageCommand(id)])),
    ...Object.fromEntries(EDITOR_COMMAND_IDS.map((id) => [id, editorCommand(id)]))
};
