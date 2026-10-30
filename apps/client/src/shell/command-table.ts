import {
    Activity,
    AppWindow,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowRightToLine,
    ArrowUp,
    Braces,
    Cable,
    ChartSpline,
    ChevronDown,
    ChevronsDown,
    ChevronsLeft,
    ChevronsRight,
    ChevronsUp,
    ChevronUp,
    CircleAlert,
    CircleDot,
    CircleOff,
    CircleStop,
    Clock,
    CalendarPlus,
    CodeXml,
    Coffee,
    Command,
    Copy,
    CornerUpRight,
    Crosshair,
    Database,
    DatabaseZap,
    Download,
    Eraser,
    Expand,
    EyeOff,
    FileText,
    FilePlus,
    Flag,
    Focus,
    Folder,
    FolderCog,
    FolderInput,
    FolderOpen,
    FolderPlus,
    Frame,
    Fullscreen,
    Gauge,
    GitBranch,
    GitFork,
    GitPullRequest,
    Globe,
    Group,
    Heading,
    Hourglass,
    Inbox,
    Info,
    Keyboard,
    LayoutGrid,
    ListChecks,
    ListX,
    Lock,
    Maximize2,
    MessageSquare,
    MessageSquarePlus,
    MessageSquareText,
    Minus,
    Moon,
    MousePointer2,
    Package,
    PanelBottom,
    PanelLeft,
    PanelRight,
    PanelRightOpen,
    Pencil,
    PenTool,
    Percent,
    Play,
    Redo2,
    Replace,
    RotateCw,
    Save,
    ScrollText,
    Search,
    SendHorizontal,
    Server,
    Settings,
    Settings2,
    Square,
    SquareArrowOutUpRight,
    SquareDashed,
    SquareTerminal,
    StickyNote,
    Sun,
    SunMoon,
    TabletSmartphone,
    Terminal,
    TextSearch,
    Trash,
    Type,
    Undo2,
    Ungroup,
    Users,
    Workflow,
    X,
    type LucideIcon
} from 'lucide-react';
import { matchesShortcut, type KeyLike, type Shortcut } from '@adecore/ui';
import { SEND_AND_NEW_SHORTCUT } from '@adecore/agents-react/chat';
import { ADD_NODE_SHORTCUTS, CANVAS_SHORTCUTS, FOCUS_SHORTCUTS, NODE_NAVIGATION_SHORTCUTS } from '@/canvas/shortcuts';
import { LANGUAGE_COMMAND_IDS, LANGUAGE_COMMANDS, type LanguageCommandId } from '@/language/command-table';
import { EDITOR_COMMAND_IDS, EDITOR_COMMANDS, type EditorCommandGroup, type EditorCommandId } from '@/shell/editor-commands';
import { editorShortcut } from '@/shell/editor-keymap';
import type { MenuContext } from '@/shell/menu/model';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { CLEAR_SHORTCUT, platformShortcut, TERMINAL_FIND_SHORTCUT } from '@/terminal/keymap';

/* A menu of the bar or a submenu with a fixed place, whose groups `menu/model.ts` lays out. */
export type MenuContainer =
    | 'app'
    | 'file'
    | 'new-view'
    | 'edit'
    | 'code'
    | 'folding'
    | 'view'
    | 'kind'
    | 'chat-move'
    | 'go'
    | 'run'
    | 'launches-after-settle'
    | 'window'
    | 'help'
    | 'keep-awake'
    | 'layouts';

interface MenuWords {
    key: string;
    values?: Record<string, string>;
}

/* Where a command sits in the menu tree, and what the menu reads off the moment for it. */
export interface MenuPlace {
    readonly menu: MenuContainer;
    /* Groups are drawn in the order `menu/model.ts` gives them, with a line between two that have rows. */
    readonly group: string;
    /* Its place among the rows of the group, the generated ones included. */
    readonly order: number;
    readonly when?: (context: MenuContext) => boolean;
    /* Undefined leaves the field out, which the shell reads as enabled. */
    readonly enabled?: (context: MenuContext) => boolean | undefined;
    readonly checked?: (context: MenuContext) => boolean;
    readonly radio?: true;
    /* Words that follow the moment, in place of `shell:menu.<key>`. */
    readonly words?: (context: MenuContext) => MenuWords;
    /* Whether the row shows its shortcut now. The key is bound regardless. */
    readonly showsShortcut?: (context: MenuContext) => boolean;
    /* A key the row shows in place of the command's, for one that whatever has the focus answers by itself. */
    readonly shortcut?: (context: MenuContext) => Shortcut | undefined;
}

/*
 * One command a person can give from the menu, the palette or the keyboard. Its words are
 * `shell:menu.<key>` and `shell:palette.commands.<key>`; what it does is in `shell/commands.ts` for a
 * palette row and in `menu/actions.ts` for a menu row of its own.
 */
interface CommandSpec {
    readonly key: string;
    readonly icon: LucideIcon;
    readonly shortcut?: Shortcut;
    /*
     * The listener that binds the shortcut, once on `window`: `shell/app-shortcuts.ts` for the window, which
     * the start screen has too, or `canvas/canvas-shortcuts.ts` for the workspace. Without it the row only
     * shows the key, and whatever has the focus answers it (the editor, a composer).
     */
    readonly binds?: 'window' | 'workspace';
    /* The palette has a row for it (`appCommands()`); without one the menu runs it itself. */
    readonly palette: boolean;
    readonly menu?: MenuPlace | readonly MenuPlace[];
}

const ZOOMABLE: readonly NonNullable<MenuContext['view']>[] = ['canvas', 'drawing', 'diagram'];

function zoomable(context: MenuContext): boolean {
    return context.view !== null && ZOOMABLE.includes(context.view);
}

function worktreeChat(context: MenuContext): boolean {
    return context.workspace && context.folder && !context.scratch;
}

function chosenLaunchOf(context: MenuContext): MenuContext['launches'][number] | null {
    return context.launches.find((launch) => launch.id === context.chosenLaunch) ?? null;
}

export function desktop(context: MenuContext): boolean {
    return context.host === 'desktop';
}

export function onCanvas(context: MenuContext): boolean {
    return context.view === 'canvas';
}

function severalCells(context: MenuContext): boolean {
    return context.cells > 1;
}

function hosted(context: MenuContext): boolean {
    return context.tabs.hosted;
}

const TABLE = {
    about: {
        key: 'about',
        icon: Info,
        palette: false,
        menu: [
            { menu: 'app', group: 'about', order: 10 },
            { menu: 'help', group: 'about', order: 10, when: (context) => !context.apple || !desktop(context) }
        ]
    },
    settings: {
        key: 'settings',
        icon: Settings,
        shortcut: APP_SHORTCUTS.settings,
        binds: 'window',
        palette: true,
        menu: [
            { menu: 'app', group: 'settings', order: 10 },
            { menu: 'file', group: 'settings', order: 10, when: (context) => !context.apple }
        ]
    },
    'keep-awake-off': {
        key: 'keepAwakeOff',
        icon: Moon,
        palette: true,
        menu: { menu: 'keep-awake', group: 'modes', order: 10, checked: (context) => context.keepAwake === 'off', radio: true }
    },
    'keep-awake-working': {
        key: 'keepAwakeWorking',
        icon: Coffee,
        palette: true,
        menu: { menu: 'keep-awake', group: 'modes', order: 20, checked: (context) => context.keepAwake === 'working', radio: true }
    },
    'keep-awake-always': {
        key: 'keepAwakeAlways',
        icon: Sun,
        palette: true,
        menu: { menu: 'keep-awake', group: 'modes', order: 30, checked: (context) => context.keepAwake === 'always', radio: true }
    },
    'window-new': {
        key: 'newWindow',
        icon: AppWindow,
        shortcut: APP_SHORTCUTS.newWindow,
        binds: 'window',
        palette: true,
        menu: { menu: 'file', group: 'new', order: 10, when: (context) => context.windows }
    },
    'chat-new': {
        key: 'newChat',
        icon: MessageSquarePlus,
        shortcut: APP_SHORTCUTS.newChat,
        binds: 'window',
        palette: true,
        menu: { menu: 'file', group: 'new', order: 20, when: (context) => context.newChat }
    },
    'chat-new-worktree': {
        key: 'newChatInWorktree',
        icon: GitBranch,
        palette: true,
        menu: { menu: 'file', group: 'new', order: 30, when: worktreeChat }
    },
    'issue-start': { key: 'startFromIssue', icon: CircleDot, palette: true, menu: { menu: 'file', group: 'new', order: 40, when: worktreeChat } },
    'view-new': {
        key: 'newCanvasView',
        icon: Frame,
        shortcut: CANVAS_SHORTCUTS.newView,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'new-view', group: 'views', order: 10 }
    },
    'view-new-drawing': { key: 'newDrawingView', icon: PenTool, palette: true, menu: { menu: 'new-view', group: 'views', order: 20 } },
    'view-new-diagram': { key: 'newDiagramView', icon: Workflow, palette: true, menu: { menu: 'new-view', group: 'views', order: 30 } },
    'view-new-terminal': { key: 'newTerminalView', icon: Terminal, palette: true, menu: { menu: 'new-view', group: 'views', order: 40 } },
    'view-new-file': {
        key: 'newFileView',
        icon: FileText,
        palette: true,
        menu: { menu: 'new-view', group: 'views', order: 50, when: (context) => context.folder }
    },
    'view-new-browser': { key: 'newBrowserView', icon: Globe, palette: true, menu: { menu: 'new-view', group: 'views', order: 60 } },
    'view-new-separator': { key: 'newSeparator', icon: Minus, palette: true, menu: { menu: 'new-view', group: 'dividers', order: 10 } },
    'view-new-subheader': { key: 'newSubheader', icon: Heading, palette: true, menu: { menu: 'new-view', group: 'dividers', order: 20 } },
    'open-folder': { key: 'openFolder', icon: FolderOpen, palette: true, menu: { menu: 'file', group: 'open', order: 20 } },
    'file-new': {
        key: 'newFile',
        icon: FilePlus,
        palette: true,
        menu: { menu: 'file', group: 'open', order: 30, when: (context) => context.workspace && context.folder }
    },
    'folder-new': {
        key: 'newFolder',
        icon: FolderPlus,
        palette: true,
        menu: { menu: 'file', group: 'open', order: 40, when: (context) => context.workspace && context.folder }
    },
    'database-console-new': {
        key: 'newDatabaseConsole',
        icon: SquareTerminal,
        palette: true,
        menu: { menu: 'file', group: 'open', order: 50, when: (context) => context.workspace && !context.scratch }
    },
    reveal: {
        key: 'reveal',
        icon: CornerUpRight,
        palette: true,
        menu: {
            menu: 'file',
            group: 'open',
            order: 60,
            when: (context) => context.workspace && context.folder,
            words: (context) => ({ key: 'reveal', values: { app: context.fileManager } })
        }
    },
    'project-settings': {
        key: 'projectSettings',
        icon: FolderCog,
        palette: false,
        menu: { menu: 'file', group: 'open', order: 70, when: (context) => context.workspace }
    },
    'database-connections': {
        key: 'databaseConnections',
        icon: Cable,
        palette: true,
        menu: { menu: 'file', group: 'open', order: 80, when: (context) => context.workspace && !context.scratch }
    },
    'database-schemas-refresh': {
        key: 'refreshSqlSchemas',
        icon: DatabaseZap,
        palette: true,
        menu: { menu: 'file', group: 'open', order: 90, when: (context) => context.workspace && !context.scratch }
    },
    'window-move': {
        key: 'moveToNewWindow',
        icon: SquareArrowOutUpRight,
        palette: true,
        menu: { menu: 'file', group: 'close', order: 10, when: (context) => context.workspace && context.windows }
    },
    // The key is bound once, through Close Cell, which closes the tab in front of a host first.
    'tab-close': {
        key: 'closeTab',
        icon: X,
        shortcut: CANVAS_SHORTCUTS.closeCell,
        palette: true,
        menu: { menu: 'file', group: 'close', order: 20, when: (context) => context.workspace && hosted(context) }
    },
    // Without a cell the desktop app closes the window in its place; in a host the key is the tab's.
    'close-cell': {
        key: 'closeCell',
        icon: X,
        shortcut: CANVAS_SHORTCUTS.closeCell,
        binds: 'workspace',
        palette: false,
        menu: {
            menu: 'file',
            group: 'close',
            order: 30,
            when: (context) => context.workspace && (context.cells > 0 || !desktop(context)),
            enabled: (context) => (context.cells > 0 ? undefined : false),
            showsShortcut: (context) => context.cells > 0 && !hosted(context)
        }
    },
    'cell-close-others': {
        key: 'closeOtherCells',
        icon: ListX,
        palette: true,
        menu: { menu: 'file', group: 'close', order: 40, when: (context) => context.workspace, enabled: severalCells }
    },
    'cell-close-right': {
        key: 'closeCellsRight',
        icon: ArrowRightToLine,
        palette: true,
        menu: { menu: 'file', group: 'close', order: 50, when: (context) => context.workspace, enabled: (context) => context.closesRight }
    },
    // A page cannot reach the browser's own undo, so the web client undoes what has a history of its own.
    'edit-undo': {
        key: 'undo',
        icon: Undo2,
        shortcut: CANVAS_SHORTCUTS.undo,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'edit', group: 'history', order: 30, when: (context) => !desktop(context) && context.workspace, enabled: zoomable }
    },
    'edit-redo': {
        key: 'redo',
        icon: Redo2,
        shortcut: CANVAS_SHORTCUTS.redo,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'edit', group: 'history', order: 40, when: (context) => !desktop(context) && context.workspace, enabled: zoomable }
    },
    find: {
        key: 'find',
        icon: TextSearch,
        shortcut: CANVAS_SHORTCUTS.find,
        binds: 'workspace',
        palette: true,
        // A focused terminal answers its own find key (`terminal/xterm.ts`), which is not the window's off macOS; one without a find bar answers none.
        menu: {
            menu: 'edit',
            group: 'find',
            order: 10,
            shortcut: (context) => {
                if (!context.terminalKeys) {
                    return CANVAS_SHORTCUTS.find;
                }
                return context.terminalFind ? platformShortcut(TERMINAL_FIND_SHORTCUT, context.apple) : undefined;
            }
        }
    },
    'find-replace': {
        key: 'findReplace',
        icon: Replace,
        shortcut: CANVAS_SHORTCUTS.findReplace,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'edit', group: 'find', order: 20 }
    },
    // The menu shows no key: its group command holds Cmd+G, and the editor answers the key itself.
    'find-next': {
        key: 'findNext',
        icon: ArrowDown,
        shortcut: editorShortcut('findNext'),
        palette: true,
        menu: { menu: 'edit', group: 'find', order: 30, showsShortcut: () => false }
    },
    'find-previous': {
        key: 'findPrevious',
        icon: ArrowUp,
        shortcut: editorShortcut('findPrevious'),
        palette: true,
        menu: { menu: 'edit', group: 'find', order: 40, showsShortcut: () => false }
    },
    // A diff answers the key on its own editors (`shell/panels/diff-caret.ts`), since a file's editor gives it to Text End.
    'open-file-at-line': {
        key: 'jumpToSource',
        icon: FileText,
        shortcut: editorShortcut('jumpToSource'),
        palette: true,
        menu: { menu: 'go', group: 'editor-navigation', order: 100, enabled: (context) => context.diff }
    },
    'next-problem': {
        key: 'nextProblem',
        icon: ArrowDown,
        shortcut: CANVAS_SHORTCUTS.nextProblem,
        palette: true,
        menu: { menu: 'edit', group: 'problems', order: 10 }
    },
    'previous-problem': {
        key: 'previousProblem',
        icon: ArrowUp,
        shortcut: CANVAS_SHORTCUTS.previousProblem,
        palette: true,
        menu: { menu: 'edit', group: 'problems', order: 20 }
    },
    'next-highlight': {
        key: 'nextHighlight',
        icon: ArrowDown,
        shortcut: CANVAS_SHORTCUTS.nextHighlight,
        palette: true,
        menu: { menu: 'edit', group: 'problems', order: 30 }
    },
    'previous-highlight': {
        key: 'previousHighlight',
        icon: ArrowUp,
        shortcut: CANVAS_SHORTCUTS.previousHighlight,
        palette: true,
        menu: { menu: 'edit', group: 'problems', order: 40 }
    },
    // While the settings dialog is up, where it stands in for the canvas's find.
    'settings-search': {
        key: 'searchSettings',
        icon: Search,
        shortcut: APP_SHORTCUTS.settingsSearch,
        binds: 'window',
        palette: true,
        menu: { menu: 'edit', group: 'search', order: 10, when: (context) => context.settingsOpen }
    },
    'find-in-files': {
        key: 'findInFiles',
        icon: Search,
        shortcut: APP_SHORTCUTS.findInFiles,
        binds: 'window',
        palette: true,
        // Off macOS a focused terminal keeps Ctrl+Shift+F for its own find (`TERMINAL_FIND_SHORTCUT`).
        menu: {
            menu: 'edit',
            group: 'search',
            order: 20,
            when: (context) => context.workspace && context.folder,
            showsShortcut: (context) => context.apple || !context.terminalKeys
        }
    },
    'search-chats': {
        key: 'searchChats',
        icon: MessageSquareText,
        palette: true,
        menu: { menu: 'edit', group: 'search', order: 30, when: (context) => context.workspace }
    },
    'pr-show': {
        key: 'showPullRequest',
        icon: GitPullRequest,
        palette: true,
        menu: { menu: 'code', group: 'pull-request', order: 20, when: (context) => context.prRepos.length <= 1 }
    },
    'pr-watch-stop': {
        key: 'stopPrWatch',
        icon: EyeOff,
        palette: true,
        menu: { menu: 'code', group: 'pr-watch', order: 10, when: (context) => context.prWatch }
    },
    sidebar: {
        key: 'toggleSidebar',
        icon: PanelLeft,
        shortcut: APP_SHORTCUTS.sidebar,
        binds: 'window',
        palette: true,
        menu: { menu: 'view', group: 'sidebar', order: 10, checked: (context) => context.sidebar }
    },
    'panel-files': {
        key: 'toggleFiles',
        icon: Folder,
        palette: true,
        menu: { menu: 'view', group: 'panels', order: 10, when: (context) => !context.scratch, checked: (context) => context.panel === 'files' }
    },
    'panel-output': {
        key: 'toggleOutput',
        icon: Package,
        palette: true,
        menu: { menu: 'view', group: 'panels', order: 25, checked: (context) => context.panel === 'output' }
    },
    'panel-databases': {
        key: 'toggleDatabases',
        icon: Database,
        palette: true,
        menu: { menu: 'view', group: 'panels', order: 30, when: (context) => !context.scratch, checked: (context) => context.panel === 'databases' }
    },
    'panel-git': {
        key: 'toggleGit',
        icon: GitBranch,
        palette: true,
        menu: { menu: 'view', group: 'panels', order: 20, when: (context) => !context.scratch, checked: (context) => context.panel === 'git' }
    },
    'panel-devices': {
        key: 'devices',
        icon: TabletSmartphone,
        palette: false,
        menu: { menu: 'view', group: 'panels', order: 40, when: (context) => !context.scratch, checked: (context) => context.panel === 'devices' }
    },
    routines: {
        key: 'routines',
        icon: Clock,
        shortcut: CANVAS_SHORTCUTS.routines,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'view', group: 'panels', order: 45, when: (context) => context.routines }
    },
    'routine-new': {
        key: 'newRoutine',
        icon: CalendarPlus,
        palette: true,
        menu: { menu: 'file', group: 'new', order: 50, when: (context) => context.routines }
    },
    'panel-toggle': {
        key: 'togglePanel',
        icon: PanelRightOpen,
        shortcut: CANVAS_SHORTCUTS.togglePanel,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'view', group: 'panels', order: 50 }
    },
    'split-right': {
        key: 'splitRight',
        icon: PanelRight,
        shortcut: CANVAS_SHORTCUTS.splitRight,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'view', group: 'split', order: 10, enabled: (context) => context.split.right }
    },
    'split-down': {
        key: 'splitDown',
        icon: PanelBottom,
        shortcut: CANVAS_SHORTCUTS.splitDown,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'view', group: 'split', order: 20, enabled: (context) => context.split.down }
    },
    'tab-move-left': {
        key: 'moveTabLeft',
        icon: ArrowLeft,
        shortcut: CANVAS_SHORTCUTS.moveTabLeft,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'view', group: 'split', order: 30, when: hosted, enabled: (context) => context.tabs.index > 0 }
    },
    'tab-move-right': {
        key: 'moveTabRight',
        icon: ArrowRight,
        shortcut: CANVAS_SHORTCUTS.moveTabRight,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'view', group: 'split', order: 40, when: hosted, enabled: (context) => context.tabs.index < context.tabs.count - 1 }
    },
    'project-tab-move-left': { key: 'moveProjectTabLeft', icon: ArrowLeft, palette: true },
    'project-tab-move-right': { key: 'moveProjectTabRight', icon: ArrowRight, palette: true },
    'tab-split-off': {
        key: 'moveTabToNewCell',
        icon: PanelRight,
        palette: true,
        menu: { menu: 'view', group: 'split', order: 50, when: hosted, enabled: (context) => context.tabs.splitOff }
    },
    'tab-ungroup': {
        key: 'ungroup',
        icon: Ungroup,
        palette: true,
        menu: { menu: 'view', group: 'split', order: 60, when: hosted, enabled: (context) => context.tabs.count === 1 }
    },
    // One key for both: a node on the canvas takes it first (`maximizeTargetOf`), so the row it acts on shows it.
    'cell-maximize': {
        key: 'maximizeCell',
        icon: Expand,
        shortcut: CANVAS_SHORTCUTS.maximizeCell,
        binds: 'workspace',
        palette: true,
        menu: {
            menu: 'view',
            group: 'split',
            order: 70,
            enabled: severalCells,
            checked: (context) => context.maximized,
            showsShortcut: (context) => !context.nodeMaximizable
        }
    },
    'node-maximize': {
        key: 'maximizeNode',
        icon: Expand,
        shortcut: CANVAS_SHORTCUTS.maximizeCell,
        palette: true,
        menu: {
            menu: 'view',
            group: 'split',
            order: 80,
            enabled: (context) => context.nodeMaximizable,
            checked: (context) => context.nodeMaximized,
            showsShortcut: (context) => context.nodeMaximizable
        }
    },
    'note-lock-preview': {
        key: 'lockNotePreview',
        icon: Lock,
        palette: true
    },
    fit: {
        key: 'zoomToFit',
        icon: Maximize2,
        shortcut: CANVAS_SHORTCUTS.fitAll,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'view', group: 'zoom', order: 10, enabled: zoomable }
    },
    'zoom-selection': {
        key: 'zoomToSelection',
        icon: Focus,
        shortcut: CANVAS_SHORTCUTS.zoomSelection,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'view', group: 'zoom', order: 20, enabled: zoomable }
    },
    'zoom-node': {
        key: 'zoomToNode',
        icon: Crosshair,
        shortcut: CANVAS_SHORTCUTS.zoomNode,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'view', group: 'zoom', order: 30, when: onCanvas, enabled: (context) => context.nodeZoomable && !context.nodeMaximized }
    },
    'zoom-reset': {
        key: 'zoomReset',
        icon: Percent,
        shortcut: CANVAS_SHORTCUTS.zoomReset,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'view', group: 'zoom', order: 40, enabled: zoomable }
    },
    theme: { key: 'toggleTheme', icon: SunMoon, palette: true, menu: { menu: 'view', group: 'theme', order: 10 } },
    // The desktop app has the shell's own full screen; only the web client asks the page.
    fullscreen: {
        key: 'fullScreen',
        icon: Fullscreen,
        palette: false,
        menu: { menu: 'view', group: 'screen', order: 30, when: (context) => !desktop(context), checked: (context) => context.fullscreen }
    },
    // A terminal with the keyboard takes the same key to clear itself, as every macOS terminal does.
    palette: {
        key: 'palette',
        icon: Command,
        shortcut: APP_SHORTCUTS.palette,
        binds: 'window',
        palette: false,
        menu: { menu: 'go', group: 'palette', order: 10, showsShortcut: (context) => !context.terminalKeys }
    },
    'view-previous': {
        key: 'previousView',
        icon: ChevronsLeft,
        shortcut: CANVAS_SHORTCUTS.previousView,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'go', group: 'views', order: 10, enabled: (context) => context.navigation.views }
    },
    'view-next': {
        key: 'nextView',
        icon: ChevronsRight,
        shortcut: CANVAS_SHORTCUTS.nextView,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'go', group: 'views', order: 20, enabled: (context) => context.navigation.views }
    },
    'camera-back': {
        key: 'cameraBack',
        icon: ArrowLeft,
        shortcut: CANVAS_SHORTCUTS.cameraBack,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'views', order: 30, when: onCanvas, enabled: (context) => context.navigation.camera.back }
    },
    'camera-forward': {
        key: 'cameraForward',
        icon: ArrowRight,
        shortcut: CANVAS_SHORTCUTS.cameraForward,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'views', order: 40, when: onCanvas, enabled: (context) => context.navigation.camera.forward }
    },
    'tab-previous': {
        key: 'previousTab',
        icon: ArrowLeft,
        shortcut: CANVAS_SHORTCUTS.previousTab,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'views', order: 50, when: hosted, enabled: (context) => context.tabs.count > 1 }
    },
    'tab-next': {
        key: 'nextTab',
        icon: ArrowRight,
        shortcut: CANVAS_SHORTCUTS.nextTab,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'views', order: 60, when: hosted, enabled: (context) => context.tabs.count > 1 }
    },
    'focus-left': {
        key: 'focusLeft',
        icon: ArrowLeft,
        shortcut: FOCUS_SHORTCUTS.left,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'go', group: 'focus', order: 10, enabled: (context) => context.navigation.focus.left }
    },
    'focus-right': {
        key: 'focusRight',
        icon: ArrowRight,
        shortcut: FOCUS_SHORTCUTS.right,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'go', group: 'focus', order: 20, enabled: (context) => context.navigation.focus.right }
    },
    'focus-up': {
        key: 'focusUp',
        icon: ArrowUp,
        shortcut: FOCUS_SHORTCUTS.up,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'go', group: 'focus', order: 30, enabled: (context) => context.navigation.focus.up }
    },
    'focus-down': {
        key: 'focusDown',
        icon: ArrowDown,
        shortcut: FOCUS_SHORTCUTS.down,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'go', group: 'focus', order: 40, enabled: (context) => context.navigation.focus.down }
    },
    'node-left': {
        key: 'nodeLeft',
        icon: ArrowLeft,
        shortcut: NODE_NAVIGATION_SHORTCUTS.left,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'nodes', order: 10, enabled: (context) => context.navigation.nodes.left }
    },
    'node-right': {
        key: 'nodeRight',
        icon: ArrowRight,
        shortcut: NODE_NAVIGATION_SHORTCUTS.right,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'nodes', order: 20, enabled: (context) => context.navigation.nodes.right }
    },
    'node-up': {
        key: 'nodeUp',
        icon: ArrowUp,
        shortcut: NODE_NAVIGATION_SHORTCUTS.up,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'nodes', order: 30, enabled: (context) => context.navigation.nodes.up }
    },
    'node-down': {
        key: 'nodeDown',
        icon: ArrowDown,
        shortcut: NODE_NAVIGATION_SHORTCUTS.down,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'nodes', order: 40, enabled: (context) => context.navigation.nodes.down }
    },
    prompts: {
        key: 'prompts',
        icon: Inbox,
        shortcut: CANVAS_SHORTCUTS.focusPrompts,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'go', group: 'prompts', order: 10, when: onCanvas, enabled: (context) => context.navigation.prompts }
    },
    // From anywhere, a terminal included, as the prompts key is.
    'needs-you-next': {
        key: 'nextNeedsYou',
        icon: Hourglass,
        shortcut: CANVAS_SHORTCUTS.nextNeedsYou,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'prompts', order: 20, enabled: (context) => context.navigation.waiting }
    },
    'attention-queue': {
        key: 'attentionQueue',
        icon: ListChecks,
        shortcut: CANVAS_SHORTCUTS.attentionQueue,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'go', group: 'prompts', order: 30 }
    },
    'launch-run': {
        key: 'launch',
        icon: Play,
        shortcut: CANVAS_SHORTCUTS.launchRun,
        binds: 'workspace',
        palette: false,
        menu: {
            menu: 'run',
            group: 'launch',
            order: 10,
            enabled: (context) => chosenLaunchOf(context) !== null,
            words: (context) => {
                const chosen = chosenLaunchOf(context);
                return chosen === null ? { key: 'launch' } : { key: chosen.live ? 'launchRestart' : 'launchStart', values: { name: chosen.name } };
            }
        }
    },
    'launch-stop': {
        key: 'launchStopNone',
        icon: Square,
        shortcut: CANVAS_SHORTCUTS.launchStop,
        binds: 'workspace',
        palette: false,
        menu: {
            menu: 'run',
            group: 'launch',
            order: 20,
            enabled: (context) => chosenLaunchOf(context)?.live === true,
            words: (context) => {
                const chosen = chosenLaunchOf(context);
                return chosen === null ? { key: 'launchStopNone' } : { key: 'launchStop', values: { name: chosen.name } };
            }
        }
    },
    'launches-stop-all': {
        key: 'launchesStopAll',
        icon: CircleStop,
        palette: false,
        menu: { menu: 'run', group: 'launch', order: 30, enabled: (context) => context.launches.some((launch) => launch.live) }
    },
    'launches-output': {
        key: 'launchesOutput',
        icon: SquareTerminal,
        palette: false,
        menu: { menu: 'run', group: 'setup', order: 20, enabled: (context) => chosenLaunchOf(context) !== null }
    },
    'launches-edit': { key: 'launchesEdit', icon: Pencil, palette: true, menu: { menu: 'run', group: 'setup', order: 30 } },
    'launches-after-settle-off': {
        key: 'launchesAfterSettleOff',
        icon: CircleOff,
        palette: true,
        menu: { menu: 'launches-after-settle', group: 'off', order: 10, checked: (context) => context.afterSettle.chosen === null, radio: true }
    },
    'panel-processes': {
        key: 'toggleProcesses',
        icon: Activity,
        palette: true,
        menu: { menu: 'window', group: 'panels', order: 10, when: (context) => context.workspace, checked: (context) => context.panel === 'processes' }
    },
    'panel-problems': {
        key: 'toggleProblems',
        icon: CircleAlert,
        palette: true,
        menu: {
            menu: 'window',
            group: 'panels',
            order: 20,
            when: (context) => context.workspace && !context.scratch,
            checked: (context) => context.panel === 'problems'
        }
    },
    usage: { key: 'usage', icon: Gauge, palette: true, menu: { menu: 'window', group: 'panels', order: 30 } },
    models: { key: 'compareModels', icon: ChartSpline, palette: true, menu: { menu: 'window', group: 'panels', order: 40 } },
    // The measurements of `docs/NEXT.md` §3: `appCommands()` offers these in a dev build only, and no menu has them.
    'measure-scene': { key: 'measureScene', icon: Gauge, palette: true },
    'measure-scene-grid': { key: 'measureGrid', icon: Gauge, palette: true },
    'measure-scene-files': { key: 'measureFiles', icon: Gauge, palette: true },
    'measure-scene-chats': { key: 'measureChats', icon: Gauge, palette: true },
    'measure-scene-terminals': { key: 'measureTerminals', icon: Gauge, palette: true },
    'measure-copy': { key: 'measureCopy', icon: Copy, palette: true },
    'settings-editor': { key: 'editorSettings', icon: CodeXml, palette: true, menu: { menu: 'window', group: 'panels', order: 50 } },
    'settings-machines': { key: 'machines', icon: Server, palette: true, menu: { menu: 'window', group: 'panels', order: 60 } },
    'settings-computer': { key: 'computerUse', icon: MousePointer2, palette: true, menu: { menu: 'window', group: 'panels', order: 70 } },
    onboarding: {
        key: 'onboarding',
        icon: ListChecks,
        palette: true,
        menu: { menu: 'help', group: 'help', order: 10, when: (context) => desktop(context) && context.localMachine }
    },
    'release-notes': {
        key: 'releaseNotes',
        icon: ScrollText,
        palette: false,
        menu: { menu: 'help', group: 'help', order: 20, when: (context) => context.releaseNotes }
    },
    'settings-keyboard': { key: 'keyboardShortcuts', icon: Keyboard, palette: true, menu: { menu: 'help', group: 'help', order: 30 } },
    'add-terminal': {
        key: 'addTerminal',
        icon: Terminal,
        shortcut: ADD_NODE_SHORTCUTS.terminal,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'canvas-add', order: 10 }
    },
    'add-chat': {
        key: 'addChat',
        icon: MessageSquare,
        shortcut: ADD_NODE_SHORTCUTS.chat,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'canvas-add', order: 20 }
    },
    'add-browser': {
        key: 'addBrowser',
        icon: Globe,
        shortcut: ADD_NODE_SHORTCUTS.browser,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'canvas-add', order: 30 }
    },
    'add-note': {
        key: 'addNote',
        icon: StickyNote,
        shortcut: ADD_NODE_SHORTCUTS.note,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'canvas-add', order: 40 }
    },
    'add-text': { key: 'addText', icon: Type, palette: true, menu: { menu: 'kind', group: 'canvas-add', order: 50 } },
    'add-file': { key: 'addFile', icon: FileText, palette: true, menu: { menu: 'kind', group: 'canvas-add', order: 60, when: (context) => context.folder } },
    'add-group': {
        key: 'addGroup',
        icon: Group,
        shortcut: ADD_NODE_SHORTCUTS.group,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'canvas-add', order: 70 }
    },
    'group-selection': {
        key: 'groupSelection',
        icon: SquareDashed,
        shortcut: CANVAS_SHORTCUTS.group,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'canvas-arrange', order: 10, enabled: (context) => context.selection > 0 }
    },
    'group-arrange': {
        key: 'arrangeGroup',
        icon: LayoutGrid,
        palette: true,
        menu: { menu: 'kind', group: 'canvas-arrange', order: 20, enabled: (context) => context.groupArrangeable }
    },
    'view-promote': {
        key: 'openAsView',
        icon: SquareArrowOutUpRight,
        palette: true,
        menu: { menu: 'kind', group: 'canvas-arrange', order: 30, enabled: (context) => context.promote }
    },
    lock: {
        key: 'lockAll',
        icon: Lock,
        palette: true,
        menu: { menu: 'kind', group: 'canvas-layout', order: 10, words: (context) => ({ key: context.anyLocked ? 'unlockAll' : 'lockAll' }) }
    },
    'layout-save': { key: 'saveLayout', icon: Save, palette: true, menu: { menu: 'layouts', group: 'save', order: 10 } },
    // The terminal's own key handler answers the key (`terminal/xterm.ts`), so the row shows it only while a terminal has the keyboard.
    'terminal-clear': {
        key: 'clear',
        icon: Eraser,
        palette: false,
        menu: {
            menu: 'kind',
            group: 'terminal',
            order: 10,
            shortcut: (context) => (context.terminalKeys ? platformShortcut(CLEAR_SHORTCUT, context.apple) : undefined)
        }
    },
    'drawing-copy-png': { key: 'drawingCopyPng', icon: Copy, palette: true, menu: { menu: 'kind', group: 'drawing-copy', order: 10 } },
    'drawing-copy-svg': { key: 'drawingCopySvg', icon: Copy, palette: true, menu: { menu: 'kind', group: 'drawing-copy', order: 20 } },
    'drawing-save-png': { key: 'drawingSavePng', icon: Download, palette: true, menu: { menu: 'kind', group: 'drawing-save', order: 10 } },
    'drawing-save-svg': { key: 'drawingSaveSvg', icon: Download, palette: true, menu: { menu: 'kind', group: 'drawing-save', order: 20 } },
    'drawing-show-on-canvas': { key: 'drawingOnCanvas', icon: Frame, palette: true, menu: { menu: 'kind', group: 'drawing-show', order: 10 } },
    'diagram-copy-json': { key: 'diagramCopyJson', icon: Copy, palette: true, menu: { menu: 'kind', group: 'diagram-copy', order: 10 } },
    'diagram-copy-png': { key: 'diagramCopyPng', icon: Copy, palette: true, menu: { menu: 'kind', group: 'diagram-copy', order: 20 } },
    'diagram-copy-svg': { key: 'diagramCopySvg', icon: Copy, palette: true, menu: { menu: 'kind', group: 'diagram-copy', order: 30 } },
    'diagram-save-png': { key: 'diagramSavePng', icon: Download, palette: true, menu: { menu: 'kind', group: 'diagram-save', order: 10 } },
    'diagram-save-svg': { key: 'diagramSaveSvg', icon: Download, palette: true, menu: { menu: 'kind', group: 'diagram-save', order: 20 } },
    'diagram-open-json': {
        key: 'diagramOpenJson',
        icon: Braces,
        palette: true,
        menu: { menu: 'kind', group: 'diagram-save', order: 30, when: (context) => context.folder }
    },
    'diagram-show-on-canvas': { key: 'diagramOnCanvas', icon: Frame, palette: true, menu: { menu: 'kind', group: 'diagram-show', order: 10 } },
    // The composer answers the key itself.
    'chat-send-new': {
        key: 'sendAndNewChat',
        icon: SendHorizontal,
        shortcut: SEND_AND_NEW_SHORTCUT,
        palette: true,
        menu: { menu: 'kind', group: 'chat', order: 10 }
    },
    'chat-restart': { key: 'restartAgentSession', icon: RotateCw, palette: true, menu: { menu: 'kind', group: 'chat', order: 20 } },
    'chat-effort-up': {
        key: 'raiseEffort',
        icon: ChevronsUp,
        shortcut: CANVAS_SHORTCUTS.raiseEffort,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'chat', order: 30 }
    },
    'chat-effort-down': {
        key: 'lowerEffort',
        icon: ChevronsDown,
        shortcut: CANVAS_SHORTCUTS.lowerEffort,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'chat', order: 40 }
    },
    /* No key here: Alt+Up and Alt+Down are the Go menu's node rows, and the canvas listener steps the
       messages first while the keyboard is in a chat's thread. */
    'chat-message-previous': { key: 'previousMessage', icon: ChevronUp, palette: true, menu: { menu: 'kind', group: 'chat', order: 50 } },
    'chat-message-next': { key: 'nextMessage', icon: ChevronDown, palette: true, menu: { menu: 'kind', group: 'chat', order: 60 } },
    'view-fork': {
        key: 'fork',
        icon: GitFork,
        palette: false,
        menu: { menu: 'kind', group: 'session', order: 10, when: (context) => context.offers?.fork === true }
    },
    'view-open-in-chat': {
        key: 'openInChat',
        icon: MessageSquare,
        palette: false,
        menu: { menu: 'kind', group: 'session', order: 20, when: (context) => context.offers?.openInChat === true }
    },
    'view-open-in-terminal': {
        key: 'openInTerminal',
        icon: Terminal,
        palette: false,
        menu: { menu: 'kind', group: 'session', order: 30, when: (context) => context.offers?.openInTerminal === true }
    },
    'view-duplicate': {
        key: 'duplicate',
        icon: Copy,
        palette: false,
        menu: { menu: 'kind', group: 'session', order: 40, when: (context) => context.offers?.duplicate === true }
    },
    'chat-make-project': {
        key: 'makeProject',
        icon: FolderPlus,
        palette: true,
        menu: { menu: 'kind', group: 'place', order: 5, when: (context) => context.offers?.makeProject === true, enabled: (context) => !context.chatWorking }
    },
    // The submenu's last row; its recent projects are generated rows (`menu/model.ts`).
    'chat-move-to-project': {
        key: 'moveToProject',
        icon: FolderInput,
        palette: true,
        menu: { menu: 'chat-move', group: 'other', order: 100, words: () => ({ key: 'otherProject' }) }
    },
    'view-put-on-canvas': {
        key: 'putOnCanvas',
        icon: Frame,
        palette: false,
        menu: { menu: 'kind', group: 'place', order: 10, when: (context) => context.offers?.putOnCanvas === true }
    },
    // The palette's own way to the same thing as Put on Canvas, for a session view only.
    'view-demote': { key: 'putOnCanvas', icon: Frame, palette: true },
    'view-reveal': {
        key: 'reveal',
        icon: CornerUpRight,
        palette: false,
        menu: {
            menu: 'kind',
            group: 'place',
            order: 20,
            when: (context) => context.offers?.reveal === true,
            words: (context) => ({ key: 'reveal', values: { app: context.fileManager } })
        }
    },
    'view-share': {
        key: 'share',
        icon: Users,
        palette: false,
        menu: {
            menu: 'kind',
            group: 'settings',
            order: 10,
            when: (context) => context.offers?.share === true,
            words: (context) => ({ key: context.shared ? 'unshare' : 'share' })
        }
    },
    'flag-toggle': {
        key: 'toggleFlag',
        icon: Flag,
        shortcut: CANVAS_SHORTCUTS.toggleFlag,
        binds: 'workspace',
        palette: true,
        menu: { menu: 'kind', group: 'settings', order: 20 }
    },
    'view-settings': { key: 'viewSettings', icon: Settings2, palette: true, menu: { menu: 'kind', group: 'settings', order: 30 } },
    'view-delete': { key: 'deleteView', icon: Trash, palette: true, menu: { menu: 'kind', group: 'delete', order: 10 } }
} satisfies Record<string, CommandSpec>;

type OwnCommandId = keyof typeof TABLE;

export type CommandId = OwnCommandId | LanguageCommandId | EditorCommandId;

/* The rows the menu runs itself, since the palette has none for them (`menu/actions.ts`). */
export type MenuOnlyCommandId = { [Id in OwnCommandId]: (typeof TABLE)[Id]['palette'] extends false ? Id : never }[OwnCommandId];

/* The rows the palette has with the table's words. The language and editing commands make their own (`languageCommandRows`, `editorCommandRows`). */
export type PaletteCommandId = Exclude<OwnCommandId, MenuOnlyCommandId>;

/* The rows `shell/app-shortcuts.ts` binds. */
export type WindowCommandId = { [Id in OwnCommandId]: (typeof TABLE)[Id] extends { binds: 'window' } ? Id : never }[OwnCommandId];

/* The rows `canvas/canvas-shortcuts.ts` binds. */
export type WorkspaceCommandId = { [Id in OwnCommandId]: (typeof TABLE)[Id] extends { binds: 'workspace' } ? Id : never }[OwnCommandId];

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
            ...(spec.menu === 'go' ? { enabled: (context: MenuContext) => context.navigation.language } : {})
        }
    };
}

function editorCommand(id: EditorCommandId): CommandSpec {
    const spec = EDITOR_COMMANDS[id];
    const order = EDITOR_COMMAND_IDS.indexOf(id);
    return {
        key: spec.key,
        icon: spec.icon,
        ...(spec.shortcut ? { shortcut: spec.shortcut } : {}),
        palette: true,
        menu: editorMenuPlace(spec.group, order)
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
            return { menu: 'go', group: 'editor-navigation', order, enabled: (context) => context.navigation.editor };
        case 'zoom':
            return { menu: 'view', group: 'code-zoom', order };
        default:
            return { menu: 'code', group: 'editor', order };
    }
}

/* Every command a person is offered, in the order of the table; the language and editing commands come from their own tables. */
export const COMMAND_IDS: readonly CommandId[] = [...(Object.keys(TABLE) as OwnCommandId[]), ...LANGUAGE_COMMAND_IDS, ...EDITOR_COMMAND_IDS];

export const COMMANDS: Readonly<Record<CommandId, CommandSpec>> = {
    ...(TABLE as Record<OwnCommandId, CommandSpec>),
    ...(Object.fromEntries((Object.keys(LANGUAGE_COMMANDS) as LanguageCommandId[]).map((id) => [id, languageCommand(id)])) as Record<
        LanguageCommandId,
        CommandSpec
    >),
    ...(Object.fromEntries(EDITOR_COMMAND_IDS.map((id) => [id, editorCommand(id)])) as Record<EditorCommandId, CommandSpec>)
};

export function isCommandId(id: string): id is CommandId {
    return (COMMAND_IDS as readonly string[]).includes(id);
}

export function menuPlacesOf(id: CommandId): readonly MenuPlace[] {
    const places = COMMANDS[id].menu;
    if (places === undefined) {
        return [];
    }
    return 'menu' in places ? [places as MenuPlace] : (places as readonly MenuPlace[]);
}

/* The rows one listener binds, each with its key. */
export function boundCommands(listener: 'window'): [WindowCommandId, Shortcut][];
export function boundCommands(listener: 'workspace'): [WorkspaceCommandId, Shortcut][];
export function boundCommands(listener: 'window' | 'workspace'): [CommandId, Shortcut][];
export function boundCommands(listener: 'window' | 'workspace'): [CommandId, Shortcut][] {
    return COMMAND_IDS.flatMap((id): [CommandId, Shortcut][] => {
        const { binds, shortcut } = COMMANDS[id];
        return binds === listener && shortcut !== undefined ? [[id, shortcut]] : [];
    });
}

const WINDOW_KEYS = boundCommands('window');
const WORKSPACE_KEYS = boundCommands('workspace');

/* The command a keystroke is for one listener, or null for a key that is none of its. */
export function commandForKey(listener: 'window', e: KeyLike, apple: boolean): WindowCommandId | null;
export function commandForKey(listener: 'workspace', e: KeyLike, apple: boolean): WorkspaceCommandId | null;
export function commandForKey(listener: 'window' | 'workspace', e: KeyLike, apple: boolean): CommandId | null {
    const keys: [CommandId, Shortcut][] = listener === 'window' ? WINDOW_KEYS : WORKSPACE_KEYS;
    return keys.find(([, shortcut]) => matchesShortcut(shortcut, e, apple))?.[0] ?? null;
}
