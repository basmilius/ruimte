import type { EditorRunCommand } from '@adecore/editor';
import type { KeymapId } from '@adecore/editor/keymap';
import type { Shortcut } from '@adecore/ui';
import i18next from 'i18next';
import {
    ArrowDownAZ,
    ArrowDownFromLine,
    ArrowDownToLine,
    ArrowDownUp,
    ArrowRightToLine,
    ArrowUpFromLine,
    ArrowUpToLine,
    Book,
    BookOpen,
    BoxSelect,
    Braces,
    Brackets,
    CaseSensitive,
    ChevronDown,
    ChevronUp,
    ChevronsDown,
    ChevronsDownUp,
    ChevronsUp,
    ChevronsUpDown,
    ClipboardType,
    Code,
    Columns3,
    CornerDownLeft,
    CornerDownRight,
    CornerLeftUp,
    FoldHorizontal,
    FoldVertical,
    IndentIncrease,
    ListChecks,
    ListCollapse,
    ListTree,
    ListX,
    Merge,
    RotateCcw,
    ScanSearch,
    Slash,
    Space,
    Split,
    TextCursor,
    UnfoldVertical,
    WholeWord,
    ZoomIn,
    ZoomOut,
    type LucideIcon
} from 'lucide-react';
import { editorForCommand } from '@/surface/panels/focused-editor';
import { keyOf } from '@/surface/shortcut-overrides';

/*
 * The editing commands of a file editor that have a place in the menu and the palette, with their words
 * at `shell:menu.<key>` and `shell:palette.commands.<key>`. A table of their own, so a menu can list
 * them without loading an editor; the command table (`commands/registry.ts`) takes them in.
 */
interface EditorCommandSpec {
    readonly key: string;
    readonly icon: LucideIcon;
    readonly command: EditorRunCommand;
    /* The key of the editor's keymap that answers it, which a person may rebind. */
    readonly keymap: KeymapId;
    /* A group the Code menu keeps its own submenu for, or the group of another menu the command sits in instead. */
    readonly group?: EditorCommandGroup;
}

/* `folding` is the Code menu's submenu, `lines` and `clipboard` are groups of the Edit menu, `navigate` one of the Go menu and `zoom` one of the View menu. */
export type EditorCommandGroup = 'folding' | 'lines' | 'clipboard' | 'navigate' | 'zoom';

/* A command named as its key in the editor's keymap. */
function command(icon: LucideIcon, name: EditorRunCommand & KeymapId, group?: EditorCommandGroup): EditorCommandSpec {
    return { icon, key: name, command: name, keymap: name, ...(group === undefined ? {} : { group }) };
}

/* A folding command whose key the keymap names otherwise. */
function folding(icon: LucideIcon, name: EditorRunCommand, keymap: KeymapId): EditorCommandSpec {
    return { icon, key: name, command: name, keymap, group: 'folding' };
}

const TABLE = {
    'toggle-line-comment': command(Slash, 'toggleLineComment'),
    'toggle-block-comment': command(Code, 'toggleBlockComment'),
    'join-lines': command(Merge, 'joinLines'),
    'split-line': command(Split, 'splitLine'),
    'start-new-line': command(CornerDownLeft, 'startNewLine'),
    'start-new-line-before': command(CornerLeftUp, 'startNewLineBefore'),
    'toggle-case': command(CaseSensitive, 'toggleCase'),
    'auto-indent-lines': command(IndentIncrease, 'autoIndentLines'),
    'collapse-region': folding(FoldVertical, 'collapseRegion', 'collapse'),
    'expand-region': folding(UnfoldVertical, 'expandRegion', 'expand'),
    'collapse-region-recursively': folding(ListCollapse, 'collapseRegionRecursively', 'collapseRecursively'),
    'expand-region-recursively': folding(ListTree, 'expandRegionRecursively', 'expandRecursively'),
    'collapse-all-regions': folding(ChevronsDownUp, 'collapseAllRegions', 'collapseAll'),
    'expand-all-regions': folding(ChevronsUpDown, 'expandAllRegions', 'expandAll'),
    'fold-selection': command(FoldHorizontal, 'foldSelection', 'folding'),
    'collapse-doc-comments': command(Book, 'collapseDocComments', 'folding'),
    'expand-doc-comments': command(BookOpen, 'expandDocComments', 'folding'),
    'expand-all-to-level-1': command(ListTree, 'expandAllToLevel1', 'folding'),
    'expand-all-to-level-2': command(ListTree, 'expandAllToLevel2', 'folding'),
    'expand-all-to-level-3': command(ListTree, 'expandAllToLevel3', 'folding'),
    'expand-all-to-level-4': command(ListTree, 'expandAllToLevel4', 'folding'),
    'expand-all-to-level-5': command(ListTree, 'expandAllToLevel5', 'folding'),
    'select-next-occurrence': command(ScanSearch, 'selectNextOccurrence'),
    'unselect-occurrence': command(BoxSelect, 'unselectOccurrence'),
    'select-all-occurrences': command(ListChecks, 'selectAllOccurrences'),
    'add-caret-above': command(ArrowUpToLine, 'addCaretAbove'),
    'add-caret-below': command(ArrowDownToLine, 'addCaretBelow'),
    'toggle-column-mode': command(Columns3, 'toggleColumnMode'),
    'add-caret-per-selected-line': command(TextCursor, 'addCaretPerSelectedLine'),
    'sort-lines': command(ArrowDownAZ, 'sortLines', 'lines'),
    'reverse-lines': command(ArrowDownUp, 'reverseLines', 'lines'),
    'unique-lines': command(ListX, 'uniqueLines', 'lines'),
    'convert-indents-to-spaces': command(Space, 'convertIndentsToSpaces', 'lines'),
    'convert-indents-to-tabs': command(ArrowRightToLine, 'convertIndentsToTabs', 'lines'),
    'complete-current-statement': command(CornerDownRight, 'completeCurrentStatement'),
    'move-statement-up': command(ArrowUpFromLine, 'moveStatementUp', 'lines'),
    'move-statement-down': command(ArrowDownFromLine, 'moveStatementDown', 'lines'),
    'paste-as-plain-text': command(ClipboardType, 'pasteAsPlainText', 'clipboard'),
    'hippie-completion': command(WholeWord, 'hippieCompletion'),
    'hippie-backward-completion': command(WholeWord, 'hippieBackwardCompletion'),
    'next-change': command(ChevronsDown, 'nextChange', 'navigate'),
    'previous-change': command(ChevronsUp, 'previousChange', 'navigate'),
    'method-up': command(ChevronUp, 'methodUp', 'navigate'),
    'method-down': command(ChevronDown, 'methodDown', 'navigate'),
    'code-block-start': command(Braces, 'codeBlockStart', 'navigate'),
    'code-block-end': command(Braces, 'codeBlockEnd', 'navigate'),
    'code-block-start-with-selection': command(Brackets, 'codeBlockStartWithSelection', 'navigate'),
    'code-block-end-with-selection': command(Brackets, 'codeBlockEndWithSelection', 'navigate'),
    'increase-font-size': command(ZoomIn, 'increaseFontSize', 'zoom'),
    'decrease-font-size': command(ZoomOut, 'decreaseFontSize', 'zoom'),
    'reset-font-size': command(RotateCcw, 'resetFontSize', 'zoom')
} satisfies Record<string, EditorCommandSpec>;

export type EditorCommandId = keyof typeof TABLE;

export const EDITOR_COMMANDS: Record<EditorCommandId, EditorCommandSpec> = TABLE;

export const EDITOR_COMMAND_IDS = Object.keys(EDITOR_COMMANDS) as EditorCommandId[];

interface EditorCommandRow {
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
        shortcut: keyOf(EDITOR_COMMANDS[id].keymap),
        run: () => {
            requestAnimationFrame(() => {
                editorForCommand()?.runCommand(EDITOR_COMMANDS[id].command);
            });
        }
    }));
}
