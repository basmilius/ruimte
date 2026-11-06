import {
    AppWindow,
    ArrowLeft,
    ArrowRight,
    ChartSpline,
    CodeXml,
    Coffee,
    Command,
    FolderCog,
    FolderOpen,
    Fullscreen,
    Gauge,
    Info,
    Keyboard,
    ListChecks,
    Moon,
    MousePointer2,
    PanelLeft,
    PanelRightOpen,
    ScrollText,
    Search,
    Server,
    Settings,
    ShieldOff,
    SquareArrowOutUpRight,
    Sun,
    SunMoon
} from 'lucide-react';
import { desktop } from '@/commands/conditions';
import { type CommandSpec } from '@/commands/types';
import { CANVAS_SHORTCUTS } from '@/surface/canvas/shortcuts';
import { APP_SHORTCUTS } from '@/surface/shortcuts';

export const WINDOW_COMMANDS = {
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
    // While the settings dialog is up, where it stands in for the canvas's find.
    'settings-search': {
        key: 'searchSettings',
        icon: Search,
        shortcut: APP_SHORTCUTS.settingsSearch,
        binds: 'window',
        palette: true,
        menu: { menu: 'edit', group: 'search', order: 10, when: (context) => context.settingsOpen }
    },
    'settings-keyboard': { key: 'keyboardShortcuts', icon: Keyboard, palette: true, menu: { menu: 'help', group: 'help', order: 30 } },
    // A desktop window has no address to add `?safe-mode` to.
    'restart-safe-mode': {
        key: 'restartSafeMode',
        icon: ShieldOff,
        palette: false,
        menu: { menu: 'help', group: 'help', order: 40, when: (context) => context.safeModeRestart }
    },
    'settings-editor': { key: 'editorSettings', icon: CodeXml, palette: true, menu: { menu: 'window', group: 'panels', order: 50 } },
    'settings-machines': { key: 'machines', icon: Server, palette: true, menu: { menu: 'window', group: 'panels', order: 60 } },
    'settings-computer': { key: 'computerUse', icon: MousePointer2, palette: true, menu: { menu: 'window', group: 'panels', order: 70 } },
    'window-new': {
        key: 'newWindow',
        icon: AppWindow,
        shortcut: APP_SHORTCUTS.newWindow,
        binds: 'window',
        palette: true,
        menu: { menu: 'file', group: 'new', order: 10, when: (context) => context.windows }
    },
    'window-move': {
        key: 'moveToNewWindow',
        icon: SquareArrowOutUpRight,
        palette: true,
        menu: { menu: 'file', group: 'close', order: 10, when: (context) => context.workspace && context.windows }
    },
    'project-tab-move-left': { key: 'moveProjectTabLeft', icon: ArrowLeft, palette: true },
    'project-tab-move-right': { key: 'moveProjectTabRight', icon: ArrowRight, palette: true },
    sidebar: {
        key: 'toggleSidebar',
        icon: PanelLeft,
        shortcut: APP_SHORTCUTS.sidebar,
        binds: 'window',
        palette: true,
        menu: { menu: 'view', group: 'sidebar', order: 10, checked: (context) => context.sidebar }
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
    // The desktop app has the shell's own full screen; only the web client asks the page.
    fullscreen: {
        key: 'fullScreen',
        icon: Fullscreen,
        palette: false,
        menu: { menu: 'view', group: 'screen', order: 30, when: (context) => !desktop(context), checked: (context) => context.fullscreen }
    },
    theme: { key: 'toggleTheme', icon: SunMoon, palette: true, menu: { menu: 'view', group: 'theme', order: 10 } },
    'release-notes': {
        key: 'releaseNotes',
        icon: ScrollText,
        palette: false,
        menu: { menu: 'help', group: 'help', order: 20, when: (context) => context.releaseNotes }
    },
    onboarding: {
        key: 'onboarding',
        icon: ListChecks,
        palette: true,
        menu: { menu: 'help', group: 'help', order: 10, when: (context) => desktop(context) && context.localMachine }
    },
    usage: { key: 'usage', icon: Gauge, palette: true, menu: { menu: 'window', group: 'panels', order: 30 } },
    models: { key: 'compareModels', icon: ChartSpline, palette: true, menu: { menu: 'window', group: 'panels', order: 40 } },
    'open-folder': { key: 'openFolder', icon: FolderOpen, palette: true, menu: { menu: 'file', group: 'open', order: 20 } },
    'project-settings': {
        key: 'projectSettings',
        icon: FolderCog,
        palette: false,
        menu: { menu: 'file', group: 'open', order: 70, when: (context) => context.workspace }
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
    'panel-toggle': {
        key: 'togglePanel',
        icon: PanelRightOpen,
        shortcut: CANVAS_SHORTCUTS.togglePanel,
        binds: 'workspace',
        palette: false,
        menu: { menu: 'view', group: 'panels', order: 50 }
    }
} satisfies Record<string, CommandSpec>;
