import i18next from 'i18next';
import type { ProjectView } from '@ruimte/contracts';
import type { MenuNode, MenuRole, MenuShellAction, MenuSpec } from '@ruimte/desktop-bridge';
import { ADD_NODE_SHORTCUTS, CANVAS_SHORTCUTS, FOCUS_SHORTCUTS, viewShortcut } from '@/canvas/shortcuts';
import { LANGUAGE_COMMANDS, languageCommandsOf } from '@/language/command-table';
import { EDITOR_COMMANDS, editorCommandsOf } from '@/shell/editor-commands';
import { APP_SHORTCUTS, BROWSER_KEEPS } from '@/shell/shortcuts';
import type { ViewOffers } from '@/shell/view-offers';
import type { KeepAwakeMode } from '@/state/settings';
import type { PanelKind } from '@/state/ui';
import { formatShortcut, type Shortcut } from '@adecore/ui';
import { GO_VIEW_PREFIX, LAUNCH_CHOOSE_PREFIX, type MenuActionId, type PaletteId } from '@/shell/menu/ids';

export type MenuHost = 'desktop' | 'station';

export interface MenuLaunch {
    id: string;
    name: string;
    /* A process of it runs, or is being stopped; a group through its members. */
    live: boolean;
}

export interface MenuAgent {
    kind: string;
    name: string;
    chat: boolean;
    terminal: boolean;
}

/* Everything the menu depends on, flat, so the tree follows from it alone. */
export interface MenuContext {
    host: MenuHost;
    apple: boolean;
    /* A project is open in this window; the start screen has none. */
    workspace: boolean;
    /* The project has a folder a person may see; the Chats project has none. */
    folder: boolean;
    /* The project is the machine's Chats project, which has no panels for a folder and no launches. */
    scratch: boolean;
    fileManager: string;
    /* The kind of the view in the focused cell. */
    view: ProjectView['kind'] | null;
    offers: ViewOffers | null;
    shared: boolean;
    /* The nodes selected on the canvas with the focus. */
    selection: number;
    /* The one selected node could open as a view of its own. */
    promote: boolean;
    anyLocked: boolean;
    cells: number;
    /* The focused cell as a host of tabs: how many, which one is in front, and whether the tab in front has room to leave for a cell of its own. */
    tabs: { hosted: boolean; count: number; index: number; splitOff: boolean };
    split: { right: boolean; down: boolean };
    /* A cell fills the grid for now. */
    maximized: boolean;
    /* The maximize key acts on a node of the canvas with the focus (`maximizeTargetOf`), not on the cell. */
    nodeMaximizable: boolean;
    /* A node fills that canvas for now. */
    nodeMaximized: boolean;
    /* Columns stand right of the focused cell. */
    closesRight: boolean;
    /* The open panel, or null while none is. */
    panel: PanelKind | null;
    sidebar: boolean;
    /* The openable views in sidebar order; the first nine have a shortcut. */
    views: string[];
    moveTargets: { id: string; name: string }[];
    layouts: string[];
    agents: MenuAgent[];
    /* The launches of the project, in their order. */
    launches: MenuLaunch[];
    /* The launch on the chip, which the Run menu's first rows act on. */
    chosenLaunch: string | null;
    releaseNotes: boolean;
    /* The page fills the screen, which only the web client asks the page itself. */
    fullscreen: boolean;
    /* When this computer stays awake, or null where the shell cannot hold it awake. */
    keepAwake: KeepAwakeMode | null;
    /* The settings dialog is up, where Find searches the settings instead. */
    settingsOpen: boolean;
    /* The shell opens windows of its own, a window per project. */
    windows: boolean;
    /* A chat outside any project can start from this window (`project/new-chat.ts`). */
    newChat: boolean;
}

type CommandId = MenuActionId | PaletteId;

interface CommandOptions {
    shortcut?: Shortcut;
    enabled?: boolean;
    checked?: boolean;
    radio?: boolean;
}

const KEEP_AWAKE_LABELS: Record<KeepAwakeMode, string> = { off: 'keepAwakeOff', working: 'keepAwakeWorking', always: 'keepAwakeAlways' };

function t(key: string, options?: Record<string, unknown>): string {
    return i18next.t(`shell:menu.${key}`, options ?? {});
}

const ELECTRON_KEYS: Record<string, string> = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', '+': 'Plus' };

/*
 * The accelerator the shell shows next to an item. On macOS a menu shows only what it also binds, and
 * a key without Cmd or Ctrl would be taken from every text field, so those get none there.
 */
export function toAccelerator(shortcut: Shortcut, apple: boolean): string | undefined {
    if (shortcut.key === '' || (apple && !shortcut.mod && !shortcut.meta && !shortcut.ctrl)) {
        return undefined;
    }
    const parts: string[] = [];
    if (shortcut.mod) {
        parts.push('CommandOrControl');
    }
    if (shortcut.ctrl) {
        parts.push('Control');
    }
    if (shortcut.meta) {
        parts.push(apple ? 'Command' : 'Super');
    }
    if (shortcut.alt) {
        parts.push('Alt');
    }
    if (shortcut.shift) {
        parts.push('Shift');
    }
    parts.push(ELECTRON_KEYS[shortcut.key] ?? shortcut.key);
    return parts.join('+');
}

function sameShortcut(one: Shortcut, other: Shortcut): boolean {
    return (
        one.key === other.key &&
        one.mod === other.mod &&
        one.ctrl === other.ctrl &&
        one.meta === other.meta &&
        one.alt === other.alt &&
        one.shift === other.shift
    );
}

const separator: MenuNode = { kind: 'separator' };

function role(name: MenuRole, label: string): MenuNode {
    return { kind: 'role', role: name, label };
}

function shell(action: MenuShellAction, label: string): MenuNode {
    return { kind: 'shell', action, label };
}

function submenu(id: string, label: string, items: MenuNode[], enabled?: boolean): MenuNode {
    return {
        kind: 'submenu',
        id,
        label,
        items: tidy(items),
        ...(enabled === undefined ? {} : { enabled })
    };
}

/* No line at either end and never two in a row, so a group that is not offered takes its line with it. */
export function tidy(items: MenuNode[]): MenuNode[] {
    return items.filter(
        (item, index) =>
            item.kind !== 'separator' ||
            (index > 0 &&
                index < items.length - 1 &&
                items[index - 1]!.kind !== 'separator' &&
                items.slice(index + 1).some((next) => next.kind !== 'separator'))
    );
}

function only(condition: boolean, ...items: MenuNode[]): MenuNode[] {
    return condition ? items : [];
}

const ZOOMABLE: readonly ProjectView['kind'][] = ['canvas', 'drawing', 'diagram'];

/* The kinds a cell shows with a menu of their own; a divider never has the focus and an unknown kind offers nothing. */
const KIND_MENUS: readonly ProjectView['kind'][] = ['canvas', 'drawing', 'diagram', 'chat', 'terminal', 'browser', 'file'];

/* The application menu for one moment: which view has the focus, what is selected, where it runs. */
export function menuModel(context: MenuContext): MenuSpec {
    const { apple, workspace } = context;
    const desktop = context.host === 'desktop';
    // The shell draws an accelerator; the web client prints the keys, except the ones its browser keeps.
    const shortcutOf = ({ shortcut }: CommandOptions): { accelerator?: string; keys?: string } => {
        if (!shortcut) {
            return {};
        }
        if (desktop) {
            const accelerator = toAccelerator(shortcut, apple);
            return accelerator ? { accelerator } : {};
        }
        return BROWSER_KEEPS.some((kept) => sameShortcut(kept, shortcut)) ? {} : { keys: formatShortcut(shortcut, apple) };
    };
    const command = (id: CommandId | string, label: string, options: CommandOptions = {}): MenuNode => {
        return {
            kind: 'command',
            id,
            label,
            ...shortcutOf(options),
            ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
            ...(options.checked === undefined ? {} : { checked: options.checked }),
            ...(options.radio ? { radio: true } : {})
        };
    };

    const keepAwakeItems = (Object.keys(KEEP_AWAKE_LABELS) as KeepAwakeMode[]).map((mode) =>
        command(`keep-awake-${mode}`, t(KEEP_AWAKE_LABELS[mode]), { checked: context.keepAwake === mode, radio: true })
    );
    const appMenu = {
        id: 'app',
        label: 'Ruimte',
        items: [
            command('about', t('about')),
            separator,
            command('settings', t('settings'), { shortcut: APP_SHORTCUTS.settings }),
            ...only(context.keepAwake !== null, submenu('keep-awake', t('keepAwake'), keepAwakeItems)),
            separator,
            role('services', t('services')),
            separator,
            role('hide', t('hide')),
            role('hideOthers', t('hideOthers')),
            role('unhide', t('showAll')),
            separator,
            shell('stop-machine-and-quit', t('stopAndQuit')),
            role('quit', t('quit'))
        ]
    };

    const agentViews = context.agents.flatMap((agent) => [
        ...only(agent.chat, command(`agent-view-chat-${agent.kind}`, t('agentChat', { name: agent.name }))),
        ...only(agent.terminal, command(`agent-view-terminal-${agent.kind}`, t('agentTerminal', { name: agent.name })))
    ]);
    // With one cell Cmd+W closes the window, as the stock Window menu's Close did before this menu.
    // In a host the key closes the tab in front, so Close Cell keeps no key of its own there.
    const hosted = context.tabs.hosted;
    const close =
        context.cells > 1 || !desktop
            ? command('close-cell', t('closeCell'), { shortcut: hosted ? undefined : CANVAS_SHORTCUTS.closeCell, enabled: context.cells > 1 })
            : hosted
              ? command('close-cell', t('closeCell'), { enabled: false })
              : role('close', t('closeWindow'));
    const fileMenu = {
        id: 'file',
        label: t('file'),
        items: [
            ...only(context.windows, command('window-new', t('newWindow'), { shortcut: APP_SHORTCUTS.newWindow })),
            ...only(context.newChat, command('chat-new', t('newChat'), { shortcut: APP_SHORTCUTS.newChat })),
            ...only(context.windows || context.newChat, separator),
            ...only(
                workspace,
                submenu('new-view', t('newView'), [
                    command('view-new', t('newCanvasView'), { shortcut: CANVAS_SHORTCUTS.newView }),
                    command('view-new-drawing', t('newDrawingView')),
                    command('view-new-diagram', t('newDiagramView')),
                    command('view-new-terminal', t('newTerminalView')),
                    ...only(context.folder, command('view-new-file', t('newFileView'))),
                    command('view-new-browser', t('newBrowserView')),
                    separator,
                    ...agentViews,
                    separator,
                    command('view-new-separator', t('newSeparator')),
                    command('view-new-subheader', t('newSubheader'))
                ])
            ),
            command('open-folder', t('openFolder')),
            ...only(workspace && context.folder, command('file-new', t('newFile')), command('folder-new', t('newFolder'))),
            ...only(workspace && !context.scratch, command('database-console-new', t('newDatabaseConsole'))),
            ...only(workspace && context.folder, command('reveal', t('reveal', { app: context.fileManager }))),
            ...only(workspace, command('project-settings', t('projectSettings'))),
            ...only(workspace && !context.scratch, command('database-connections', t('databaseConnections'))),
            separator,
            ...only(workspace && context.windows, command('window-move', t('moveToNewWindow'))),
            ...only(workspace && hosted, command('tab-close', t('closeTab'), { shortcut: CANVAS_SHORTCUTS.closeCell })),
            ...only(workspace || desktop, close),
            ...only(
                workspace,
                command('cell-close-others', t('closeOtherCells'), { enabled: context.cells > 1 }),
                command('cell-close-right', t('closeCellsRight'), { enabled: context.closesRight })
            ),
            ...only(!apple, separator, command('settings', t('settings'), { shortcut: APP_SHORTCUTS.settings })),
            ...only(!apple && desktop, separator, shell('stop-machine-and-quit', t('stopAndQuit')), role('quit', t('quit')))
        ]
    };

    const zoomable = context.view !== null && ZOOMABLE.includes(context.view);
    const editMenu = {
        id: 'edit',
        label: t('edit'),
        items: [
            ...only(
                desktop,
                role('undo', t('undo')),
                role('redo', t('redo')),
                separator,
                role('cut', t('cut')),
                role('copy', t('copy')),
                role('paste', t('paste')),
                role('selectAll', t('selectAll'))
            ),
            // A page cannot reach the browser's own undo, so the web client undoes what has a history of its own.
            ...only(
                !desktop && workspace,
                command('edit-undo', t('undo'), { shortcut: CANVAS_SHORTCUTS.undo, enabled: zoomable }),
                command('edit-redo', t('redo'), { shortcut: CANVAS_SHORTCUTS.redo, enabled: zoomable })
            ),
            separator,
            ...only(workspace && !context.settingsOpen, command('find', t('find'), { shortcut: CANVAS_SHORTCUTS.find })),
            ...only(workspace && !context.settingsOpen, command('find-replace', t('findReplace'), { shortcut: CANVAS_SHORTCUTS.findReplace })),
            // No accelerator: the menu's group command holds Cmd+G, and the editor answers the key itself.
            ...only(workspace && !context.settingsOpen, command('find-next', t('findNext')), command('find-previous', t('findPrevious'))),
            ...only(
                workspace && !context.settingsOpen,
                separator,
                command('next-problem', t('nextProblem'), { shortcut: CANVAS_SHORTCUTS.nextProblem }),
                command('previous-problem', t('previousProblem'), { shortcut: CANVAS_SHORTCUTS.previousProblem }),
                command('next-highlight', t('nextHighlight'), { shortcut: CANVAS_SHORTCUTS.nextHighlight }),
                command('previous-highlight', t('previousHighlight'), { shortcut: CANVAS_SHORTCUTS.previousHighlight }),
                separator
            ),
            ...only(context.settingsOpen, command('settings-search', t('searchSettings'), { shortcut: APP_SHORTCUTS.settingsSearch })),
            ...only(workspace && context.folder, command('find-in-files', t('findInFiles'), { shortcut: APP_SHORTCUTS.findInFiles }))
        ]
    };

    const codeMenu = {
        id: 'code',
        label: t('code'),
        items: [
            ...only(
                workspace && !context.settingsOpen,
                ...languageCommandsOf('code').map((id) => command(id, t(LANGUAGE_COMMANDS[id].key), { shortcut: LANGUAGE_COMMANDS[id].shortcut })),
                separator,
                ...editorCommandsOf(undefined).map((id) => command(id, t(EDITOR_COMMANDS[id].key), { shortcut: EDITOR_COMMANDS[id].shortcut })),
                submenu(
                    'folding',
                    t('folding'),
                    editorCommandsOf('folding').map((id) => command(id, t(EDITOR_COMMANDS[id].key), { shortcut: EDITOR_COMMANDS[id].shortcut }))
                )
            )
        ]
    };

    const viewMenu = {
        id: 'view',
        label: t('view'),
        items: [
            ...only(
                workspace,
                command('sidebar', t('sidebar'), { shortcut: APP_SHORTCUTS.sidebar, checked: context.sidebar }),
                separator,
                ...only(
                    !context.scratch,
                    command('panel-files', t('files'), { checked: context.panel === 'files' }),
                    command('panel-databases', t('databases'), { checked: context.panel === 'databases' }),
                    command('panel-git', t('git'), { checked: context.panel === 'git' }),
                    command('panel-devices', t('devices'), { checked: context.panel === 'devices' })
                ),
                command('panel-toggle', t('togglePanel'), { shortcut: CANVAS_SHORTCUTS.togglePanel }),
                separator,
                command('split-right', t('splitRight'), { shortcut: CANVAS_SHORTCUTS.splitRight, enabled: context.split.right }),
                command('split-down', t('splitDown'), { shortcut: CANVAS_SHORTCUTS.splitDown, enabled: context.split.down }),
                ...only(
                    hosted,
                    command('tab-move-left', t('moveTabLeft'), { shortcut: CANVAS_SHORTCUTS.moveTabLeft, enabled: context.tabs.index > 0 }),
                    command('tab-move-right', t('moveTabRight'), {
                        shortcut: CANVAS_SHORTCUTS.moveTabRight,
                        enabled: context.tabs.index < context.tabs.count - 1
                    }),
                    command('tab-split-off', t('moveTabToNewCell'), { enabled: context.tabs.splitOff }),
                    command('tab-ungroup', t('ungroup'), { enabled: context.tabs.count === 1 }),
                    separator
                ),
                command('cell-maximize', t('maximizeCell'), {
                    shortcut: context.nodeMaximizable ? undefined : CANVAS_SHORTCUTS.maximizeCell,
                    enabled: context.cells > 1,
                    checked: context.maximized
                }),
                command('node-maximize', t('maximizeNode'), {
                    shortcut: context.nodeMaximizable ? CANVAS_SHORTCUTS.maximizeCell : undefined,
                    enabled: context.nodeMaximizable,
                    checked: context.nodeMaximized
                }),
                separator,
                command('fit', t('zoomToFit'), { shortcut: CANVAS_SHORTCUTS.fitAll, enabled: zoomable }),
                command('zoom-selection', t('zoomToSelection'), { shortcut: CANVAS_SHORTCUTS.zoomSelection, enabled: zoomable }),
                command('zoom-reset', t('actualSize'), { shortcut: CANVAS_SHORTCUTS.zoomReset, enabled: zoomable })
            ),
            separator,
            command('theme', t('toggleTheme')),
            separator,
            ...only(desktop, role('togglefullscreen', t('fullScreen')), shell('devtools', t('developerTools'))),
            ...only(!desktop, command('fullscreen', t('fullScreen'), { checked: context.fullscreen }))
        ]
    };

    const goMenu = {
        id: 'go',
        label: t('go'),
        items: [
            command('palette', t('palette'), { shortcut: APP_SHORTCUTS.palette }),
            ...only(
                workspace,
                separator,
                command('view-previous', t('previousView'), { shortcut: CANVAS_SHORTCUTS.previousView }),
                command('view-next', t('nextView'), { shortcut: CANVAS_SHORTCUTS.nextView }),
                ...only(
                    hosted,
                    command('tab-previous', t('previousTab'), { shortcut: CANVAS_SHORTCUTS.previousTab, enabled: context.tabs.count > 1 }),
                    command('tab-next', t('nextTab'), { shortcut: CANVAS_SHORTCUTS.nextTab, enabled: context.tabs.count > 1 })
                ),
                separator,
                ...context.views.slice(0, 9).map((name, index) => command(`${GO_VIEW_PREFIX}${index + 1}`, name, { shortcut: viewShortcut(index) })),
                separator,
                command('focus-left', t('focusLeft'), { shortcut: FOCUS_SHORTCUTS.left, enabled: context.cells > 1 }),
                command('focus-right', t('focusRight'), { shortcut: FOCUS_SHORTCUTS.right, enabled: context.cells > 1 }),
                command('focus-up', t('focusUp'), { shortcut: FOCUS_SHORTCUTS.up, enabled: context.cells > 1 }),
                command('focus-down', t('focusDown'), { shortcut: FOCUS_SHORTCUTS.down, enabled: context.cells > 1 }),
                separator,
                command('prompts', t('prompts'), { shortcut: CANVAS_SHORTCUTS.focusPrompts }),
                ...only(
                    !context.settingsOpen,
                    separator,
                    ...languageCommandsOf('go').map((id) => command(id, t(LANGUAGE_COMMANDS[id].key), { shortcut: LANGUAGE_COMMANDS[id].shortcut }))
                )
            )
        ]
    };

    const windowMenu = {
        id: 'window',
        label: t('window'),
        items: [
            ...only(desktop, role('minimize', t('minimize'))),
            ...only(desktop && apple, role('zoom', t('zoom'))),
            separator,
            ...only(workspace, command('panel-processes', t('processes'), { checked: context.panel === 'processes' })),
            ...only(workspace && !context.scratch, command('panel-problems', t('problems'), { checked: context.panel === 'problems' })),
            command('usage', t('usage')),
            command('models', t('compareModels')),
            command('settings-editor', t('editorSettings')),
            command('settings-machines', t('machines')),
            command('settings-computer', t('computerUse')),
            ...only(desktop && apple, separator, role('front', t('front')))
        ]
    };

    const chosen = context.launches.find((launch) => launch.id === context.chosenLaunch) ?? null;
    const runLabel = chosen === null ? t('launch') : t(chosen.live ? 'launchRestart' : 'launchStart', { name: chosen.name });
    const runMenu = {
        id: 'run',
        label: t('run'),
        items: [
            command('launch-run', runLabel, { shortcut: CANVAS_SHORTCUTS.launchRun, enabled: chosen !== null }),
            command('launch-stop', chosen === null ? t('launchStopNone') : t('launchStop', { name: chosen.name }), {
                shortcut: CANVAS_SHORTCUTS.launchStop,
                enabled: chosen?.live === true
            }),
            command('launches-stop-all', t('launchesStopAll'), { enabled: context.launches.some((launch) => launch.live) }),
            separator,
            ...context.launches.map((launch) =>
                command(`${LAUNCH_CHOOSE_PREFIX}${launch.id}`, launch.name, { checked: launch.id === chosen?.id, radio: true })
            ),
            separator,
            command('launches-output', t('launchesOutput'), { enabled: chosen !== null }),
            command('launches-edit', t('launchesEdit'))
        ]
    };

    const helpMenu = {
        id: 'help',
        label: t('help'),
        items: [
            ...only(desktop, command('onboarding', t('onboarding'))),
            ...only(context.releaseNotes, command('release-notes', t('releaseNotes'))),
            command('settings-keyboard', t('keyboardShortcuts')),
            ...only(!apple || !desktop, separator, command('about', t('about')))
        ]
    };

    const kindMenu = workspace && context.view !== null ? viewKindMenu(context, command) : null;
    const menus = [
        ...(apple && desktop ? [appMenu] : []),
        fileMenu,
        editMenu,
        ...(workspace && !context.settingsOpen ? [codeMenu] : []),
        viewMenu,
        ...(kindMenu ? [kindMenu] : []),
        goMenu,
        ...(workspace && !context.scratch ? [runMenu] : []),
        windowMenu,
        helpMenu
    ];
    return { menus: menus.map((menu) => ({ id: menu.id, label: menu.label, items: tidy(menu.items) })) };
}

/* The menu of the view with the focus, named after its kind, so everything a drawing offers sits in one place. */
function viewKindMenu(
    context: MenuContext,
    command: (id: CommandId | string, label: string, options?: CommandOptions) => MenuNode
): { id: string; label: string; items: MenuNode[] } | null {
    const kind = context.view;
    if (kind === null || !KIND_MENUS.includes(kind)) {
        return null;
    }
    const offers = context.offers;
    const own: MenuNode[] = [];
    if (kind === 'canvas') {
        const agents = context.agents.flatMap((agent) => [
            ...only(agent.chat, command(`agent-chat-${agent.kind}`, t('agentChat', { name: agent.name }))),
            ...only(agent.terminal, command(`agent-terminal-${agent.kind}`, t('agentTerminal', { name: agent.name })))
        ]);
        own.push(
            command('add-terminal', t('addTerminal'), { shortcut: ADD_NODE_SHORTCUTS.terminal }),
            command('add-chat', t('addChat'), { shortcut: ADD_NODE_SHORTCUTS.chat }),
            command('add-browser', t('addBrowser'), { shortcut: ADD_NODE_SHORTCUTS.browser }),
            command('add-note', t('addNote'), { shortcut: ADD_NODE_SHORTCUTS.note }),
            command('add-text', t('addText')),
            ...only(context.folder, command('add-file', t('addFile'))),
            command('add-group', t('addGroup'), { shortcut: ADD_NODE_SHORTCUTS.group }),
            ...only(agents.length > 0, submenu('new-agent', t('newAgent'), agents)),
            separator,
            command('group-selection', t('groupSelection'), { shortcut: CANVAS_SHORTCUTS.group, enabled: context.selection > 0 }),
            command('view-promote', t('openAsView'), { enabled: context.promote }),
            submenu(
                'move-to',
                t('moveTo'),
                context.moveTargets.map((target) => command(`view-move-${target.id}`, target.name)),
                context.moveTargets.length > 0
            ),
            separator,
            command('lock', context.anyLocked ? t('unlockAll') : t('lockAll')),
            submenu('layouts', t('layouts'), [
                command('layout-save', t('saveLayout')),
                separator,
                ...context.layouts.map((name) => command(`layout-apply-${name}`, name)),
                separator,
                ...only(
                    context.layouts.length > 0,
                    submenu(
                        'delete-layout',
                        t('deleteLayout'),
                        context.layouts.map((name) => command(`layout-delete-${name}`, name))
                    )
                )
            ])
        );
    } else if (kind === 'terminal') {
        own.push(command('terminal-clear', t('clear')));
    } else if (kind === 'drawing') {
        own.push(
            command('drawing-copy-png', t('copyPng')),
            command('drawing-copy-svg', t('copySvg')),
            separator,
            command('drawing-save-png', t('savePng')),
            command('drawing-save-svg', t('saveSvg')),
            separator,
            command('drawing-show-on-canvas', t('showOnCanvas'))
        );
    } else if (kind === 'diagram') {
        own.push(
            command('diagram-copy-json', t('copyJson')),
            command('diagram-copy-png', t('copyPng')),
            command('diagram-copy-svg', t('copySvg')),
            separator,
            command('diagram-save-png', t('savePng')),
            command('diagram-save-svg', t('saveSvg')),
            ...only(context.folder, command('diagram-open-json', t('openJson'))),
            separator,
            command('diagram-show-on-canvas', t('showOnCanvas'))
        );
    }
    return {
        id: `kind-${kind}`,
        label: t(`kinds.${kind}`),
        items: [
            ...own,
            separator,
            ...only(offers?.fork === true, command('view-fork', t('fork'))),
            ...only(offers?.openInChat === true, command('view-open-in-chat', t('openInChat'))),
            ...only(offers?.openInTerminal === true, command('view-open-in-terminal', t('openInTerminal'))),
            ...only(offers?.duplicate === true, command('view-duplicate', t('duplicate'))),
            separator,
            ...only(offers?.putOnCanvas === true, command('view-put-on-canvas', t('putOnCanvas'))),
            ...only(offers?.reveal === true, command('view-reveal', t('reveal', { app: context.fileManager }))),
            separator,
            ...only(offers?.share === true, command('view-share', context.shared ? t('unshare') : t('share'))),
            command('flag-toggle', t('toggleFlag'), { shortcut: CANVAS_SHORTCUTS.toggleFlag }),
            command('view-settings', t('viewSettings')),
            separator,
            command('view-delete', t('deleteView'))
        ]
    };
}
