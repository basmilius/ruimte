import i18next from 'i18next';
import { shortcut, type Shortcut } from '@basmilius/desktop-ui';
import type { EditorCommand } from '@ruimte/smart-editor';
import { isApplePlatform } from '@/desktop/bridge';
import { focusedEditor } from '@/shell/panels/focused-editor';

/*
 * The editing commands of a file editor that have a place in the menu and the palette: the id both
 * share, the key of its words (`shell:menu.<key>` and `shell:palette.commands.<key>`), what it runs on
 * the editor and the key the editor binds it to. They sit in a table of their own so a menu can list
 * them without loading an editor.
 */
interface EditorCommandSpec {
    readonly key: string;
    readonly command: EditorCommand;
    readonly shortcut?: Shortcut;
}

const TABLE = {
    'toggle-line-comment': { key: 'toggleLineComment', command: 'toggleLineComment', shortcut: shortcut('Mod+/') },
    'toggle-block-comment': {
        key: 'toggleBlockComment',
        command: 'toggleBlockComment',
        shortcut: isApplePlatform() ? shortcut('Mod+Alt+/') : shortcut('Mod+Shift+/')
    },
    'join-lines': { key: 'joinLines', command: 'joinLines', shortcut: shortcut('Ctrl+Shift+J') },
    'split-line': { key: 'splitLine', command: 'splitLine', shortcut: shortcut('Mod+Enter') },
    'start-new-line': { key: 'startNewLine', command: 'startNewLine', shortcut: shortcut('Shift+Enter') },
    'start-new-line-before': { key: 'startNewLineBefore', command: 'startNewLineBefore', shortcut: shortcut('Mod+Alt+Enter') },
    'toggle-case': { key: 'toggleCase', command: 'toggleCase', shortcut: shortcut('Mod+Shift+U') },
    'auto-indent-lines': { key: 'autoIndentLines', command: 'autoIndentLines', shortcut: shortcut('Ctrl+Alt+I') }
} satisfies Record<string, EditorCommandSpec>;

export type EditorCommandId = keyof typeof TABLE;

export const EDITOR_COMMANDS: Record<EditorCommandId, EditorCommandSpec> = TABLE;

export const EDITOR_COMMAND_IDS = Object.keys(EDITOR_COMMANDS) as EditorCommandId[];

export interface EditorCommandRow {
    id: string;
    label: string;
    shortcut?: Shortcut;
    run(): void;
}

/* The palette's rows for the editing commands. They run after the palette has handed the focus back, which is what says which editor is meant. */
export function editorCommandRows(): EditorCommandRow[] {
    return EDITOR_COMMAND_IDS.map((id) => ({
        id,
        label: i18next.t(`shell:palette.commands.${EDITOR_COMMANDS[id].key}`),
        shortcut: EDITOR_COMMANDS[id].shortcut,
        run: () => {
            requestAnimationFrame(() => {
                focusedEditor()?.runCommand(EDITOR_COMMANDS[id].command);
            });
        }
    }));
}
