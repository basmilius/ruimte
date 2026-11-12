import type { KeymapId } from '@adecore/editor/keymap';
import {
    AlignLeft,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    AtSign,
    Blocks,
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

/*
 * The commands that act on the editor with the keyboard in it: the id the menu and the palette share, the
 * key of its words (`shell:menu.<key>` and `shell:palette.commands.<key>`), its icon and its shortcut. What
 * each one does is in `language-commands.ts`, so a menu can list them without loading an editor. The command
 * table (`commands/registry.ts`) takes them in.
 */
interface LanguageCommandSpec {
    readonly menu: 'code' | 'completion' | 'ai' | 'templates' | 'go' | 'edit';
    /* The group of the menu the command sits in; the menu's group for language commands without one. */
    readonly group?: string;
    readonly key: string;
    readonly icon: LucideIcon;
    /* The key of the editor's keymap that answers it, which a person may rebind. */
    readonly keymap?: KeymapId;
}

const TABLE = {
    'trigger-completion': { icon: ListChecks, menu: 'completion', group: 'completion', key: 'triggerCompletion', keymap: 'triggerCompletion' },
    'parameter-info': { icon: Parentheses, menu: 'code', key: 'parameterInfo', keymap: 'parameterInfo' },
    'quick-info': { icon: Info, menu: 'code', key: 'quickInfo', keymap: 'quickInfo' },
    'code-actions': { icon: Lightbulb, menu: 'code', key: 'codeActions', keymap: 'codeActions' },
    'refactor-this': { icon: Wand2, menu: 'code', key: 'refactorThis', keymap: 'refactorThis' },
    'rename-symbol': { icon: TextCursorInput, menu: 'code', key: 'renameSymbol', keymap: 'renameSymbol' },
    'organize-imports': { icon: ListOrdered, menu: 'code', key: 'organizeImports', keymap: 'organizeImports' },
    'format-document': { icon: AlignLeft, menu: 'code', key: 'formatDocument', keymap: 'formatDocument' },
    'next-agent-change': { icon: ArrowDown, menu: 'ai', group: 'ai', key: 'nextAgentChange' },
    'previous-agent-change': { icon: ArrowUp, menu: 'ai', group: 'ai', key: 'previousAgentChange' },
    'selection-to-chat': { icon: MessageSquarePlus, menu: 'ai', group: 'ai', key: 'selectionToChat', keymap: 'selectionToChat' },
    'inline-edit': { icon: Sparkles, menu: 'ai', group: 'ai', key: 'inlineEdit', keymap: 'inlineEdit' },
    'show-inline-edit': { icon: ScanSearch, menu: 'ai', group: 'ai', key: 'showInlineEdit' },
    explain: { icon: Cpu, menu: 'ai', group: 'ai', key: 'explain' },
    'suggest-inline': { icon: WandSparkles, menu: 'ai', group: 'ai', key: 'suggestInline', keymap: 'suggestInline' },
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
    'wrap-with-abbreviation': { icon: CodeXml, menu: 'templates', group: 'templates', key: 'wrapWithAbbreviation' },
    'insert-live-template': { icon: FilePlus, menu: 'templates', group: 'templates', key: 'insertLiveTemplate', keymap: 'insertLiveTemplate' },
    'surround-with': { icon: Brackets, menu: 'templates', group: 'templates', key: 'surroundWith', keymap: 'surroundWith' },
    'surround-with-live-template': {
        icon: Braces,
        menu: 'templates',
        group: 'templates',
        key: 'surroundWithLiveTemplate',
        keymap: 'surroundWithLiveTemplate'
    },
    unwrap: { icon: PackageOpen, menu: 'templates', group: 'templates', key: 'unwrap', keymap: 'unwrap' },
    'save-as-live-template': { icon: BookmarkPlus, menu: 'templates', group: 'templates', key: 'saveAsLiveTemplate' }
} satisfies Record<string, LanguageCommandSpec>;

export type LanguageCommandId = keyof typeof TABLE;

export const LANGUAGE_COMMANDS: Record<LanguageCommandId, LanguageCommandSpec> = TABLE;

export const LANGUAGE_COMMAND_IDS = Object.keys(LANGUAGE_COMMANDS) as LanguageCommandId[];
