import type { KeymapId } from '@adecore/editor/keymap';
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
import { RENDERED_DOC_COMMENTS } from '@/features';

/*
 * The commands that act on the editor with the keyboard in it: the id the menu and the palette share, the
 * key of its words (`shell:menu.<key>` and `shell:palette.commands.<key>`), its icon and its shortcut. What
 * each one does is in `language-commands.ts`, so a menu can list them without loading an editor. The command
 * table (`commands/registry.ts`) takes them in.
 */
interface LanguageCommandSpec {
    readonly menu: 'code' | 'go' | 'edit';
    /* The group of the menu the command sits in; the menu's group for language commands without one. */
    readonly group?: string;
    readonly key: string;
    readonly icon: LucideIcon;
    /* The key of the editor's keymap that answers it, which a person may rebind. */
    readonly keymap?: KeymapId;
}

const TABLE = {
    'trigger-completion': { icon: ListChecks, menu: 'code', key: 'triggerCompletion', keymap: 'triggerCompletion' },
    'parameter-info': { icon: Parentheses, menu: 'code', key: 'parameterInfo', keymap: 'parameterInfo' },
    'quick-info': { icon: Info, menu: 'code', key: 'quickInfo', keymap: 'quickInfo' },
    'code-actions': { icon: Lightbulb, menu: 'code', key: 'codeActions', keymap: 'codeActions' },
    'refactor-this': { icon: Wand2, menu: 'code', key: 'refactorThis', keymap: 'refactorThis' },
    'rename-symbol': { icon: TextCursorInput, menu: 'code', key: 'renameSymbol', keymap: 'renameSymbol' },
    'organize-imports': { icon: ListOrdered, menu: 'code', key: 'organizeImports', keymap: 'organizeImports' },
    'format-document': { icon: AlignLeft, menu: 'code', key: 'formatDocument', keymap: 'formatDocument' },
    'next-agent-change': { icon: ArrowDown, menu: 'code', key: 'nextAgentChange' },
    'previous-agent-change': { icon: ArrowUp, menu: 'code', key: 'previousAgentChange' },
    'selection-to-chat': { icon: MessageSquarePlus, menu: 'code', key: 'selectionToChat', keymap: 'selectionToChat' },
    'inline-edit': { icon: Sparkles, menu: 'code', key: 'inlineEdit', keymap: 'inlineEdit' },
    'show-inline-edit': { icon: ScanSearch, menu: 'code', key: 'showInlineEdit' },
    explain: { icon: Cpu, menu: 'code', key: 'explain' },
    'toggle-rendered-docs': { icon: BookOpen, menu: 'code', key: 'toggleRenderedDocs', keymap: 'toggleRenderedDocs' },
    'suggest-inline': { icon: WandSparkles, menu: 'code', key: 'suggestInline', keymap: 'suggestInline' },
    'go-to-symbol': { icon: AtSign, menu: 'go', key: 'goToSymbol', keymap: 'goToSymbol' },
    'go-to-definition': { icon: LocateFixed, menu: 'go', key: 'goToDefinition', keymap: 'goToDefinition' },
    'go-to-declaration': { icon: MapPin, menu: 'go', key: 'goToDeclaration' },
    'go-to-type-definition': { icon: Type, menu: 'go', key: 'goToTypeDefinition', keymap: 'goToTypeDefinition' },
    'peek-definition': { icon: FileSearch, menu: 'go', key: 'peekDefinition', keymap: 'peekDefinition' },
    'peek-references': { icon: Rows3, menu: 'go', key: 'peekReferences', keymap: 'peekReferences' },
    'call-hierarchy': { icon: Network, menu: 'go', key: 'callHierarchy', keymap: 'callHierarchy' },
    'go-to-implementation': { icon: Blocks, menu: 'go', key: 'goToImplementation', keymap: 'goToImplementation' },
    'history-back': { icon: ArrowLeft, menu: 'go', key: 'historyBack', keymap: 'historyBack' },
    'history-forward': { icon: ArrowRight, menu: 'go', key: 'historyForward', keymap: 'historyForward' },
    'recent-locations': { icon: History, menu: 'go', key: 'recentLocations', keymap: 'recentLocations' },
    'type-hierarchy': { icon: GitFork, menu: 'go', key: 'typeHierarchy', keymap: 'typeHierarchy' },
    'last-edit-location': { icon: Undo2, menu: 'go', key: 'lastEditLocation', keymap: 'lastEditLocation' },
    'next-edit-location': { icon: Redo2, menu: 'go', key: 'nextEditLocation', keymap: 'nextEditLocation' },
    'paste-from-history': { icon: ClipboardList, menu: 'edit', group: 'clipboard', key: 'pasteFromHistory', keymap: 'pasteFromHistory' },
    // Emmet keeps its row without a key: Surround with Live Template has Mod+Alt+J, as in IntelliJ.
    'wrap-with-abbreviation': { icon: CodeXml, menu: 'code', key: 'wrapWithAbbreviation' },
    'insert-live-template': { icon: FilePlus, menu: 'code', key: 'insertLiveTemplate', keymap: 'insertLiveTemplate' },
    'surround-with': { icon: Brackets, menu: 'code', key: 'surroundWith', keymap: 'surroundWith' },
    'surround-with-live-template': {
        icon: Braces,
        menu: 'code',
        key: 'surroundWithLiveTemplate',
        keymap: 'surroundWithLiveTemplate'
    },
    unwrap: { icon: PackageOpen, menu: 'code', key: 'unwrap', keymap: 'unwrap' },
    'save-as-live-template': { icon: BookmarkPlus, menu: 'code', key: 'saveAsLiveTemplate' }
} satisfies Record<string, LanguageCommandSpec>;

export type LanguageCommandId = keyof typeof TABLE;

export const LANGUAGE_COMMANDS: Record<LanguageCommandId, LanguageCommandSpec> = TABLE;

/* The commands a person is offered; the toggle for rendered documentation waits for its feature. */
export function offeredLanguageCommands(renderedDocs: boolean): LanguageCommandId[] {
    return (Object.keys(LANGUAGE_COMMANDS) as LanguageCommandId[]).filter((id) => renderedDocs || id !== 'toggle-rendered-docs');
}

export const LANGUAGE_COMMAND_IDS = offeredLanguageCommands(RENDERED_DOC_COMMENTS);
