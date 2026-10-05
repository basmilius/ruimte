import i18next from 'i18next';
import type { Shortcut } from '@adecore/ui';
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
    /* A group the Code menu keeps its own submenu for. */
    readonly group?: 'folding';
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
    'collapse-region': { key: 'collapseRegion', command: 'collapseRegion', shortcut: editorShortcut('collapse'), group: 'folding' },
    'expand-region': { key: 'expandRegion', command: 'expandRegion', shortcut: editorShortcut('expand'), group: 'folding' },
    'collapse-region-recursively': {
        key: 'collapseRegionRecursively',
        command: 'collapseRegionRecursively',
        shortcut: editorShortcut('collapseRecursively'),
        group: 'folding'
    },
    'expand-region-recursively': {
        key: 'expandRegionRecursively',
        command: 'expandRegionRecursively',
        shortcut: editorShortcut('expandRecursively'),
        group: 'folding'
    },
    'collapse-all-regions': { key: 'collapseAllRegions', command: 'collapseAllRegions', shortcut: editorShortcut('collapseAll'), group: 'folding' },
    'expand-all-regions': { key: 'expandAllRegions', command: 'expandAllRegions', shortcut: editorShortcut('expandAll'), group: 'folding' },
    'fold-selection': { key: 'foldSelection', command: 'foldSelection', shortcut: editorShortcut('foldSelection'), group: 'folding' },
    'collapse-doc-comments': { key: 'collapseDocComments', command: 'collapseDocComments', shortcut: editorShortcut('collapseDocComments'), group: 'folding' },
    'expand-doc-comments': { key: 'expandDocComments', command: 'expandDocComments', shortcut: editorShortcut('expandDocComments'), group: 'folding' },
    'expand-all-to-level-1': { key: 'expandAllToLevel1', command: 'expandAllToLevel1', shortcut: editorShortcut('expandAllToLevel1'), group: 'folding' },
    'expand-all-to-level-2': { key: 'expandAllToLevel2', command: 'expandAllToLevel2', shortcut: editorShortcut('expandAllToLevel2'), group: 'folding' },
    'expand-all-to-level-3': { key: 'expandAllToLevel3', command: 'expandAllToLevel3', shortcut: editorShortcut('expandAllToLevel3'), group: 'folding' },
    'expand-all-to-level-4': { key: 'expandAllToLevel4', command: 'expandAllToLevel4', shortcut: editorShortcut('expandAllToLevel4'), group: 'folding' },
    'expand-all-to-level-5': { key: 'expandAllToLevel5', command: 'expandAllToLevel5', shortcut: editorShortcut('expandAllToLevel5'), group: 'folding' },
    'select-next-occurrence': { key: 'selectNextOccurrence', command: 'selectNextOccurrence', shortcut: editorShortcut('selectNextOccurrence') },
    'unselect-occurrence': { key: 'unselectOccurrence', command: 'unselectOccurrence', shortcut: editorShortcut('unselectOccurrence') },
    'select-all-occurrences': { key: 'selectAllOccurrences', command: 'selectAllOccurrences', shortcut: editorShortcut('selectAllOccurrences') },
    'add-caret-above': { key: 'addCaretAbove', command: 'addCaretAbove', shortcut: editorShortcut('addCaretAbove') },
    'add-caret-below': { key: 'addCaretBelow', command: 'addCaretBelow', shortcut: editorShortcut('addCaretBelow') },
    'toggle-column-mode': { key: 'toggleColumnMode', command: 'toggleColumnMode', shortcut: editorShortcut('toggleColumnMode') },
    'add-caret-per-selected-line': { key: 'addCaretPerSelectedLine', command: 'addCaretPerSelectedLine', shortcut: editorShortcut('addCaretPerSelectedLine') }
} satisfies Record<string, EditorCommandSpec>;

export type EditorCommandId = keyof typeof TABLE;

export const EDITOR_COMMANDS: Record<EditorCommandId, EditorCommandSpec> = TABLE;

export const EDITOR_COMMAND_IDS = Object.keys(EDITOR_COMMANDS) as EditorCommandId[];

/* The ids of a group, in the order of the table. */
export function editorCommandsOf(group: 'folding' | undefined): EditorCommandId[] {
    return EDITOR_COMMAND_IDS.filter((id) => (EDITOR_COMMANDS[id] as EditorCommandSpec).group === group);
}

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
