import i18next from 'i18next';
import type { Shortcut } from '@basmilius/desktop-ui';
import type { EditorRunCommand } from '@ruimte/smart-editor';
import { editorShortcut } from '@/shell/editor-keymap';
import { focusedEditor } from '@/shell/panels/focused-editor';

/*
 * The editing commands of a file editor that have a place in the menu and the palette: the id both
 * share, the key of its words (`shell:menu.<key>` and `shell:palette.commands.<key>`), what it runs on
 * the editor and the key the editor binds it to. They sit in a table of their own so a menu can list
 * them without loading an editor.
 */
interface EditorCommandSpec {
    readonly key: string;
    readonly command: EditorRunCommand;
    readonly shortcut?: Shortcut;
}

const TABLE = {
    'toggle-line-comment': { key: 'toggleLineComment', command: 'toggleLineComment', shortcut: editorShortcut('toggleLineComment') },
    'toggle-block-comment': { key: 'toggleBlockComment', command: 'toggleBlockComment', shortcut: editorShortcut('toggleBlockComment') },
    'join-lines': { key: 'joinLines', command: 'joinLines', shortcut: editorShortcut('joinLines') },
    'split-line': { key: 'splitLine', command: 'splitLine', shortcut: editorShortcut('splitLine') },
    'start-new-line': { key: 'startNewLine', command: 'startNewLine', shortcut: editorShortcut('startNewLine') },
    'start-new-line-before': { key: 'startNewLineBefore', command: 'startNewLineBefore', shortcut: editorShortcut('startNewLineBefore') },
    'toggle-case': { key: 'toggleCase', command: 'toggleCase', shortcut: editorShortcut('toggleCase') },
    'auto-indent-lines': { key: 'autoIndentLines', command: 'autoIndentLines', shortcut: editorShortcut('autoIndentLines') },
    'collapse-region': { key: 'collapseRegion', command: 'collapseRegion', shortcut: editorShortcut('collapse') },
    'expand-region': { key: 'expandRegion', command: 'expandRegion', shortcut: editorShortcut('expand') },
    'collapse-region-recursively': { key: 'collapseRegionRecursively', command: 'collapseRegionRecursively', shortcut: editorShortcut('collapseRecursively') },
    'expand-region-recursively': { key: 'expandRegionRecursively', command: 'expandRegionRecursively', shortcut: editorShortcut('expandRecursively') },
    'collapse-all-regions': { key: 'collapseAllRegions', command: 'collapseAllRegions', shortcut: editorShortcut('collapseAll') },
    'expand-all-regions': { key: 'expandAllRegions', command: 'expandAllRegions', shortcut: editorShortcut('expandAll') },
    'fold-selection': { key: 'foldSelection', command: 'foldSelection', shortcut: editorShortcut('foldSelection') }
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
