import i18next from 'i18next';
import { KEYMAP_IDS, type KeymapId } from '@adecore/editor/keymap';
import { RENDERED_DOC_COMMENTS } from '@/features';
import { COMMANDS, isCommandId, menuPlacesOf } from '@/shell/command-table';
import { shortcutFor } from '@/shell/editor-keymap';
import type { KeyboardArea, ShortcutRow } from '@/shell/settings/shortcuts';

type EditorArea = Extract<KeyboardArea, 'editor' | 'navigation' | 'code'>;

/* A record over every key of the editor's keymap, so a key ADE CORE adds fails the build until it has a category here. */
const AREA_OF_KEY: Record<KeymapId, EditorArea> = {
    undo: 'editor',
    redo: 'editor',
    selectAll: 'editor',
    save: 'editor',
    duplicateLine: 'editor',
    deleteLine: 'editor',
    moveLineUp: 'editor',
    moveLineDown: 'editor',
    moveStatementUp: 'editor',
    moveStatementDown: 'editor',
    toggleLineComment: 'editor',
    toggleBlockComment: 'editor',
    joinLines: 'editor',
    startNewLine: 'editor',
    startNewLineBefore: 'editor',
    splitLine: 'editor',
    toggleCase: 'editor',
    autoIndentLines: 'editor',
    sortLines: 'editor',
    reverseLines: 'editor',
    uniqueLines: 'editor',
    convertIndentsToSpaces: 'editor',
    convertIndentsToTabs: 'editor',
    expandSelection: 'editor',
    shrinkSelection: 'editor',
    pasteFromHistory: 'editor',
    pasteAsPlainText: 'editor',
    selectNextOccurrence: 'editor',
    unselectOccurrence: 'editor',
    selectAllOccurrences: 'editor',
    addCaretPerSelectedLine: 'editor',
    addCaretAbove: 'editor',
    addCaretBelow: 'editor',
    toggleColumnMode: 'editor',
    collapse: 'editor',
    expand: 'editor',
    collapseAll: 'editor',
    expandAll: 'editor',
    collapseRecursively: 'editor',
    expandRecursively: 'editor',
    foldSelection: 'editor',
    collapseDocComments: 'editor',
    expandDocComments: 'editor',
    expandAllToLevel1: 'editor',
    expandAllToLevel2: 'editor',
    expandAllToLevel3: 'editor',
    expandAllToLevel4: 'editor',
    expandAllToLevel5: 'editor',
    increaseFontSize: 'editor',
    decreaseFontSize: 'editor',
    resetFontSize: 'editor',
    findNext: 'editor',
    findPrevious: 'editor',
    replace: 'editor',
    insertLiveTemplate: 'editor',
    surroundWith: 'editor',
    surroundWithLiveTemplate: 'editor',
    saveAsLiveTemplate: 'editor',
    wrapWithAbbreviation: 'editor',
    matchBrace: 'navigation',
    wordLeft: 'navigation',
    wordRight: 'navigation',
    selectWordLeft: 'navigation',
    selectWordRight: 'navigation',
    deleteWordLeft: 'editor',
    deleteWordRight: 'editor',
    smartHome: 'navigation',
    selectSmartHome: 'navigation',
    smartEnd: 'navigation',
    selectSmartEnd: 'navigation',
    textStart: 'navigation',
    selectTextStart: 'navigation',
    textEnd: 'navigation',
    selectTextEnd: 'navigation',
    methodUp: 'navigation',
    methodDown: 'navigation',
    lastEditLocation: 'navigation',
    nextEditLocation: 'navigation',
    nextChange: 'navigation',
    previousChange: 'navigation',
    codeBlockStart: 'navigation',
    codeBlockEnd: 'navigation',
    codeBlockStartWithSelection: 'navigation',
    codeBlockEndWithSelection: 'navigation',
    goToSymbol: 'navigation',
    goToDefinition: 'navigation',
    goToTypeDefinition: 'navigation',
    goToImplementation: 'navigation',
    peekDefinition: 'navigation',
    peekReferences: 'navigation',
    callHierarchy: 'navigation',
    typeHierarchy: 'navigation',
    historyBack: 'navigation',
    historyForward: 'navigation',
    recentLocations: 'navigation',
    jumpToSource: 'navigation',
    nextProblem: 'navigation',
    previousProblem: 'navigation',
    nextHighlight: 'navigation',
    previousHighlight: 'navigation',
    completeCurrentStatement: 'code',
    hippieCompletion: 'code',
    hippieBackwardCompletion: 'code',
    unwrap: 'code',
    triggerCompletion: 'code',
    parameterInfo: 'code',
    quickInfo: 'code',
    codeActions: 'code',
    refactorThis: 'code',
    renameSymbol: 'code',
    organizeImports: 'code',
    formatDocument: 'code',
    toggleRenderedDocs: 'code',
    selectionToChat: 'code',
    inlineEdit: 'code',
    suggestInline: 'code',
    acceptGhostWord: 'code'
};

/* The keys whose command row names its words otherwise. */
const WORDS_OF_KEY: Partial<Record<KeymapId, string>> = {
    collapse: 'collapseRegion',
    expand: 'expandRegion',
    collapseAll: 'collapseAllRegions',
    expandAll: 'expandAllRegions',
    collapseRecursively: 'collapseRegionRecursively',
    expandRecursively: 'expandRegionRecursively'
};

const WORD_KEYS = new Set<string>([...KEYMAP_IDS, ...Object.values(WORDS_OF_KEY)]);

/*
 * Whether the editor's keymap lists the key of this command row. It is told by the key of the row's words,
 * which is the keymap's id for a row of the editing and language tables, so a row added there is covered
 * without a list to keep. A row of another kind with a key of its own (Find, Settings) stays a command.
 */
export function isEditorCommand(id: string): boolean {
    return isCommandId(id) && WORD_KEYS.has(COMMANDS[id].key);
}

/* The words a command row has for the key, and else the ones of this pane. */
function labelOf(id: KeymapId): string {
    const key = WORDS_OF_KEY[id] ?? id;
    const found = [`shell:palette.commands.${key}`, `shell:menu.${key}`].find((path) => i18next.exists(path));
    return i18next.t(found ?? `settings:shortcuts.editor.${id}`);
}

/* Keys the Canvas category already lists under the same words, since one key does both. */
const LISTED_WITH_CANVAS: readonly KeymapId[] = ['undo', 'redo'];

/* The editor's keymap as this platform resolves it, with the category of each key; keys the platform leaves unbound are left out. */
export function editorShortcutRows(apple: boolean): { area: EditorArea; row: ShortcutRow }[] {
    return KEYMAP_IDS.flatMap((id) => {
        const keys = shortcutFor(id, apple);
        if (keys === undefined || LISTED_WITH_CANVAS.includes(id) || (id === 'toggleRenderedDocs' && !RENDERED_DOC_COMMENTS)) {
            return [];
        }
        return [{ area: AREA_OF_KEY[id], row: { keys, label: labelOf(id) } }];
    });
}

/* The category of a command row that is not an editor key, from its place in the menu. */
export function commandArea(id: string): KeyboardArea {
    if (!isCommandId(id)) {
        return 'general';
    }
    if (id === 'camera-back' || id === 'camera-forward') {
        return 'canvas';
    }
    const first = menuPlacesOf(id)[0];
    switch (first?.menu) {
        case 'edit':
            return first.group === 'find' ? 'editor' : 'general';
        case 'file':
            return first.group === 'close' ? 'views' : 'general';
        case 'new-view':
            return 'views';
        case 'view':
            return first.group === 'zoom' ? 'canvas' : 'views';
        case 'go':
            return first.group === 'nodes' ? 'canvas' : first.group === 'prompts' ? 'chat' : first.group === 'palette' ? 'general' : 'views';
        case 'run':
            return 'launches';
        case 'kind':
            return first.group === 'chat' ? 'chat' : 'canvas';
        default:
            return 'general';
    }
}
