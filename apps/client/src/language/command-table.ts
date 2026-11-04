import type { Shortcut } from '@adecore/ui';
import {
    AlignLeft,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    AtSign,
    Blocks,
    BookOpen,
    BookmarkPlus,
    Braces,
    Brackets,
    ClipboardList,
    CodeXml,
    Cpu,
    FilePlus,
    FileSearch,
    GitFork,
    History,
    Info,
    Lightbulb,
    ListChecks,
    ListOrdered,
    LocateFixed,
    MapPin,
    MessageSquarePlus,
    Network,
    PackageOpen,
    Parentheses,
    Redo2,
    Rows3,
    ScanSearch,
    Sparkles,
    TextCursorInput,
    Type,
    Undo2,
    Wand2,
    WandSparkles,
    type LucideIcon
} from 'lucide-react';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { RENDERED_DOC_COMMENTS } from '@/features';
import { editorShortcut } from '@/shell/editor-keymap';

/*
 * The commands that act on the editor with the keyboard in it: the id the menu and the palette share, the
 * key of its words (`shell:menu.<key>` and `shell:palette.commands.<key>`), its icon and its shortcut. What
 * each one does is in `language-commands.ts`, so a menu can list them without loading an editor. The command
 * table (`shell/command-table.ts`) takes them in.
 */
interface LanguageCommandSpec {
    readonly menu: 'code' | 'go' | 'edit';
    /* The group of the menu the command sits in; the menu's group for language commands without one. */
    readonly group?: string;
    readonly key: string;
    readonly icon: LucideIcon;
    readonly shortcut?: Shortcut;
}

const TABLE = {
    'trigger-completion': { icon: ListChecks, menu: 'code', key: 'triggerCompletion', shortcut: CANVAS_SHORTCUTS.triggerCompletion },
    'parameter-info': { icon: Parentheses, menu: 'code', key: 'parameterInfo', shortcut: CANVAS_SHORTCUTS.parameterInfo },
    'quick-info': { icon: Info, menu: 'code', key: 'quickInfo', shortcut: CANVAS_SHORTCUTS.quickInfo },
    'code-actions': { icon: Lightbulb, menu: 'code', key: 'codeActions', shortcut: CANVAS_SHORTCUTS.codeActions },
    'refactor-this': { icon: Wand2, menu: 'code', key: 'refactorThis', shortcut: CANVAS_SHORTCUTS.refactorThis },
    'rename-symbol': { icon: TextCursorInput, menu: 'code', key: 'renameSymbol', shortcut: CANVAS_SHORTCUTS.rename },
    'organize-imports': { icon: ListOrdered, menu: 'code', key: 'organizeImports', shortcut: CANVAS_SHORTCUTS.organizeImports },
    'format-document': { icon: AlignLeft, menu: 'code', key: 'formatDocument', shortcut: CANVAS_SHORTCUTS.formatDocument },
    'next-agent-change': { icon: ArrowDown, menu: 'code', key: 'nextAgentChange' },
    'previous-agent-change': { icon: ArrowUp, menu: 'code', key: 'previousAgentChange' },
    'selection-to-chat': { icon: MessageSquarePlus, menu: 'code', key: 'selectionToChat', shortcut: CANVAS_SHORTCUTS.selectionToChat },
    'inline-edit': { icon: Sparkles, menu: 'code', key: 'inlineEdit', shortcut: CANVAS_SHORTCUTS.inlineEdit },
    'show-inline-edit': { icon: ScanSearch, menu: 'code', key: 'showInlineEdit' },
    explain: { icon: Cpu, menu: 'code', key: 'explain' },
    'toggle-rendered-docs': { icon: BookOpen, menu: 'code', key: 'toggleRenderedDocs', shortcut: CANVAS_SHORTCUTS.toggleRenderedDocs },
    'suggest-inline': { icon: WandSparkles, menu: 'code', key: 'suggestInline', shortcut: CANVAS_SHORTCUTS.suggestInline },
    'go-to-symbol': { icon: AtSign, menu: 'go', key: 'goToSymbol', shortcut: CANVAS_SHORTCUTS.goToSymbol },
    'go-to-definition': { icon: LocateFixed, menu: 'go', key: 'goToDefinition', shortcut: CANVAS_SHORTCUTS.goToDefinition },
    'go-to-declaration': { icon: MapPin, menu: 'go', key: 'goToDeclaration' },
    'go-to-type-definition': { icon: Type, menu: 'go', key: 'goToTypeDefinition', shortcut: CANVAS_SHORTCUTS.goToTypeDefinition },
    'peek-definition': { icon: FileSearch, menu: 'go', key: 'peekDefinition', shortcut: CANVAS_SHORTCUTS.peekDefinition },
    'peek-references': { icon: Rows3, menu: 'go', key: 'peekReferences', shortcut: CANVAS_SHORTCUTS.peekReferences },
    'call-hierarchy': { icon: Network, menu: 'go', key: 'callHierarchy', shortcut: CANVAS_SHORTCUTS.callHierarchy },
    'go-to-implementation': { icon: Blocks, menu: 'go', key: 'goToImplementation', shortcut: CANVAS_SHORTCUTS.goToImplementation },
    'history-back': { icon: ArrowLeft, menu: 'go', key: 'historyBack', shortcut: CANVAS_SHORTCUTS.historyBack },
    'history-forward': { icon: ArrowRight, menu: 'go', key: 'historyForward', shortcut: CANVAS_SHORTCUTS.historyForward },
    'recent-locations': { icon: History, menu: 'go', key: 'recentLocations', shortcut: CANVAS_SHORTCUTS.recentLocations },
    'type-hierarchy': { icon: GitFork, menu: 'go', key: 'typeHierarchy', shortcut: CANVAS_SHORTCUTS.typeHierarchy },
    'last-edit-location': { icon: Undo2, menu: 'go', key: 'lastEditLocation', shortcut: CANVAS_SHORTCUTS.lastEditLocation },
    'next-edit-location': { icon: Redo2, menu: 'go', key: 'nextEditLocation', shortcut: editorShortcut('nextEditLocation') },
    'paste-from-history': { icon: ClipboardList, menu: 'edit', group: 'clipboard', key: 'pasteFromHistory', shortcut: CANVAS_SHORTCUTS.pasteFromHistory },
    // Emmet keeps its row without a key: Surround with Live Template has Mod+Alt+J, as in IntelliJ.
    'wrap-with-abbreviation': { icon: CodeXml, menu: 'code', key: 'wrapWithAbbreviation' },
    'insert-live-template': { icon: FilePlus, menu: 'code', key: 'insertLiveTemplate', shortcut: CANVAS_SHORTCUTS.insertLiveTemplate },
    'surround-with': { icon: Brackets, menu: 'code', key: 'surroundWith', shortcut: CANVAS_SHORTCUTS.surroundWith },
    'surround-with-live-template': {
        icon: Braces,
        menu: 'code',
        key: 'surroundWithLiveTemplate',
        shortcut: CANVAS_SHORTCUTS.surroundWithLiveTemplate
    },
    unwrap: { icon: PackageOpen, menu: 'code', key: 'unwrap', shortcut: CANVAS_SHORTCUTS.unwrap },
    'save-as-live-template': { icon: BookmarkPlus, menu: 'code', key: 'saveAsLiveTemplate' }
} satisfies Record<string, LanguageCommandSpec>;

export type LanguageCommandId = keyof typeof TABLE;

export const LANGUAGE_COMMANDS: Record<LanguageCommandId, LanguageCommandSpec> = TABLE;

/* The commands a person is offered; the toggle for rendered documentation waits for its feature. */
export function offeredLanguageCommands(renderedDocs: boolean): LanguageCommandId[] {
    return (Object.keys(LANGUAGE_COMMANDS) as LanguageCommandId[]).filter((id) => renderedDocs || id !== 'toggle-rendered-docs');
}

export const LANGUAGE_COMMAND_IDS = offeredLanguageCommands(RENDERED_DOC_COMMENTS);
