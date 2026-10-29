import i18next from 'i18next';
import type { ProjectView } from '@ruimte/contracts';
import type { MenuNode, MenuRole, MenuShellAction, MenuSpec } from '@ruimte/desktop-bridge';
import { viewShortcut } from '@/canvas/shortcuts';
import { BROWSER_KEEPS } from '@/shell/shortcuts';
import type { ViewOffers } from '@/shell/view-offers';
import { separatesGroups } from '@/agents/creation';
import type { KeepAwakeMode } from '@/state/settings';
import type { PanelKind } from '@/state/ui';
import { formatShortcut, type Shortcut } from '@adecore/ui';
import { AFTER_SETTLE_PREFIX, CHAT_MOVE_PREFIX, GO_VIEW_PREFIX, LAUNCH_CHOOSE_PREFIX, PR_SHOW_IN_PREFIX } from '@/shell/menu/ids';
import {
    COMMAND_IDS,
    COMMANDS,
    desktop as isDesktop,
    menuPlacesOf,
    onCanvas,
    type CommandId as TableCommandId,
    type MenuContainer,
    type MenuPlace
} from '@/shell/command-table';

export type MenuHost = 'desktop' | 'station';

export interface MenuLaunch {
    id: string;
    name: string;
    /* A process of it runs, or is being stopped; a group through its members. */
    live: boolean;
}

interface MenuAgent {
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
    /* The one selected node is a chat with a pull request watch on. */
    prWatch: boolean;
    /* The project's machine answers routines (`routine.list`). */
    routines: boolean;
    /* A chat has the focus: the chat view in the focused cell, or the chat node with the keyboard or selected alone (`focused-chat.ts`). */
    chat: boolean;
    /* A terminal has the keyboard, which takes the clear key for itself (`terminal/xterm.ts`). */
    terminalKeys: boolean;
    /* That terminal has a find bar, which answers the find key. */
    terminalFind: boolean;
    /* The view in front of the focused cell is a diff, whose file Open File at Line opens. */
    diff: boolean;
    /* The repositories of the folder that stand on a branch, which a pull request hangs on. */
    prRepos: { path: string; label: string }[];
    fileManager: string;
    /* The kind of the view in the focused cell. */
    view: ProjectView['kind'] | null;
    offers: ViewOffers | null;
    /* The chat in the focused cell runs a turn or waits on a person, so it cannot move now. */
    chatWorking: boolean;
    /* The projects of this machine a chat in Chats can move to, most recently touched first. */
    moveProjects: { id: string; name: string }[];
    shared: boolean;
    /* The nodes selected on the canvas with the focus. */
    selection: number;
    /* The one selected node could open as a view of its own. */
    promote: boolean;
    /* The one selected node is an open group whose members can be moved. */
    groupArrangeable: boolean;
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
    nodeZoomable: boolean;
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
    launches: MenuLaunch[];
    /* The launch on the chip, which the Run menu's first rows act on. */
    chosenLaunch: string | null;
    /* The tasks that may run after a worktree chat settles, and the one that does, or null for none. */
    afterSettle: { tasks: { id: string; name: string }[]; chosen: string | null };
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
    /* This app runs a machine of its own; the desktop app told to run none does not. */
    localMachine: boolean;
}

type MenuCommand = (id: string, label: string, options?: CommandOptions) => MenuNode;

type MenuSection = MenuSpec['menus'][number];

interface CommandOptions {
    shortcut?: Shortcut;
    enabled?: boolean;
    checked?: boolean;
    radio?: boolean;
}

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

function agentRows(agents: MenuAgent[], rowsOf: (agent: MenuAgent) => MenuNode[]): MenuNode[] {
    return agents.flatMap((agent, i) => [...only(separatesGroups(agents[i - 1]?.kind, agent.kind), separator), ...rowsOf(agent)]);
}

/* What a group draws besides the table's rows: a role, a submenu or a row per view, launch or agent. */
interface MenuExtra {
    readonly order: number;
    readonly build: (context: MenuContext, command: MenuCommand) => MenuNode[];
}

/* A run of rows between two lines. Its table rows say they belong to it (`MenuPlace` in `shell/command-table.ts`). */
interface MenuGroup {
    readonly id: string;
    readonly when?: (context: MenuContext) => boolean;
    readonly extras?: readonly MenuExtra[];
}

function inWorkspace(context: MenuContext): boolean {
    return context.workspace;
}

function quitRows(): MenuNode[] {
    return [shell('stop-machine-and-quit', t('stopAndQuit')), role('quit', t('quit'))];
}

/* The groups of every menu and submenu with a fixed place, top to bottom. */
const LAYOUT: Record<MenuContainer, readonly MenuGroup[]> = {
    app: [
        { id: 'about' },
        {
            id: 'settings',
            extras: [
                {
                    order: 20,
                    build: (context, command) =>
                        only(context.keepAwake !== null, submenu('keep-awake', t('keepAwake'), itemsOf('keep-awake', context, command)))
                }
            ]
        },
        { id: 'services', extras: [{ order: 10, build: () => [role('services', t('services'))] }] },
        { id: 'hide', extras: [{ order: 10, build: () => [role('hide', t('hide')), role('hideOthers', t('hideOthers')), role('unhide', t('showAll'))] }] },
        { id: 'quit', extras: [{ order: 10, build: quitRows }] }
    ],
    'keep-awake': [{ id: 'modes' }],
    file: [
        { id: 'new' },
        {
            id: 'open',
            extras: [
                {
                    order: 10,
                    build: (context, command) => only(context.workspace, submenu('new-view', t('newView'), itemsOf('new-view', context, command)))
                }
            ]
        },
        // Without a cell to close the desktop app closes the window.
        {
            id: 'close',
            extras: [{ order: 31, build: (context) => only(isDesktop(context) && !(context.workspace && context.cells > 0), role('close', t('closeWindow'))) }]
        },
        { id: 'settings' },
        { id: 'quit', when: (context) => !context.apple && isDesktop(context), extras: [{ order: 10, build: quitRows }] }
    ],
    'new-view': [
        { id: 'views' },
        {
            id: 'agents',
            extras: [
                {
                    order: 10,
                    build: (context, command) =>
                        agentRows(context.agents, (agent) => [
                            ...only(agent.chat, command(`agent-view-chat-${agent.kind}`, t('agentChat', { name: agent.name }))),
                            ...only(agent.terminal, command(`agent-view-terminal-${agent.kind}`, t('agentTerminal', { name: agent.name })))
                        ])
                }
            ]
        },
        { id: 'dividers' }
    ],
    view: [
        { id: 'sidebar', when: inWorkspace },
        { id: 'panels', when: inWorkspace },
        // The tabs of a host get a line of their own; without them maximizing follows splitting.
        { id: 'split', when: inWorkspace, extras: [{ order: 65, build: (context) => only(context.tabs.hosted, separator) }] },
        { id: 'zoom', when: inWorkspace },
        { id: 'code-zoom', when: (context) => context.workspace && !context.settingsOpen },
        { id: 'theme' },
        {
            id: 'screen',
            extras: [
                {
                    order: 10,
                    build: (context) => only(isDesktop(context), role('togglefullscreen', t('fullScreen')), shell('devtools', t('developerTools')))
                }
            ]
        }
    ],
    edit: [
        { id: 'history', extras: [{ order: 10, build: (context) => only(isDesktop(context), role('undo', t('undo')), role('redo', t('redo'))) }] },
        {
            id: 'clipboard',
            extras: [
                {
                    order: 10,
                    build: (context) =>
                        only(isDesktop(context), role('cut', t('cut')), role('copy', t('copy')), role('paste', t('paste')), role('selectAll', t('selectAll')))
                }
            ]
        },
        { id: 'find', when: (context) => context.workspace && !context.settingsOpen },
        { id: 'problems', when: (context) => context.workspace && !context.settingsOpen },
        { id: 'lines', when: (context) => context.workspace && !context.settingsOpen },
        { id: 'search' }
    ],
    code: [
        {
            id: 'pull-request',
            when: (context) => context.folder && !context.scratch,
            extras: [
                {
                    order: 10,
                    build: (context, command) =>
                        context.prRepos.length > 1
                            ? context.prRepos.map((repo) => command(`${PR_SHOW_IN_PREFIX}${repo.path}`, t('showPullRequestIn', { repo: repo.label })))
                            : []
                }
            ]
        },
        { id: 'pr-watch' },
        { id: 'language' },
        { id: 'editor', extras: [{ order: 1000, build: (context, command) => [submenu('folding', t('folding'), itemsOf('folding', context, command))] }] }
    ],
    folding: [{ id: 'folding' }],
    go: [
        { id: 'palette' },
        { id: 'views', when: inWorkspace },
        {
            id: 'go-view',
            when: inWorkspace,
            extras: [
                {
                    order: 10,
                    build: (context, command) =>
                        context.views.slice(0, 9).map((name, index) => command(`${GO_VIEW_PREFIX}${index + 1}`, name, { shortcut: viewShortcut(index) }))
                }
            ]
        },
        { id: 'focus', when: inWorkspace },
        { id: 'nodes', when: (context) => context.workspace && context.view === 'canvas' },
        { id: 'prompts', when: inWorkspace },
        { id: 'language', when: (context) => context.workspace && !context.settingsOpen },
        { id: 'editor-navigation', when: (context) => context.workspace && !context.settingsOpen }
    ],
    kind: [
        {
            id: 'canvas-add',
            when: onCanvas,
            extras: [
                {
                    order: 80,
                    build: (context, command) => {
                        const agents = agentRows(context.agents, (agent) => [
                            ...only(agent.chat, command(`agent-chat-${agent.kind}`, t('agentChat', { name: agent.name }))),
                            ...only(agent.terminal, command(`agent-terminal-${agent.kind}`, t('agentTerminal', { name: agent.name })))
                        ]);
                        return only(agents.length > 0, submenu('new-agent', t('newAgent'), agents));
                    }
                }
            ]
        },
        {
            id: 'canvas-arrange',
            when: onCanvas,
            extras: [
                {
                    order: 40,
                    build: (context, command) => [
                        submenu(
                            'move-to',
                            t('moveTo'),
                            context.moveTargets.map((target) => command(`view-move-${target.id}`, target.name)),
                            context.moveTargets.length > 0
                        )
                    ]
                }
            ]
        },
        {
            id: 'canvas-layout',
            when: onCanvas,
            extras: [{ order: 20, build: (context, command) => [submenu('layouts', t('layouts'), itemsOf('layouts', context, command))] }]
        },
        { id: 'terminal', when: (context) => context.view === 'terminal' },
        { id: 'drawing-copy', when: (context) => context.view === 'drawing' },
        { id: 'drawing-save', when: (context) => context.view === 'drawing' },
        { id: 'drawing-show', when: (context) => context.view === 'drawing' },
        { id: 'diagram-copy', when: (context) => context.view === 'diagram' },
        { id: 'diagram-save', when: (context) => context.view === 'diagram' },
        { id: 'diagram-show', when: (context) => context.view === 'diagram' },
        // A chat on a canvas has no menu of its own, so its rows go under the canvas's.
        { id: 'chat', when: (context) => (context.view === 'chat' || context.view === 'canvas') && context.chat },
        { id: 'session' },
        {
            id: 'place',
            extras: [
                {
                    order: 6,
                    build: (context, command) =>
                        only(
                            context.offers?.moveToProject === true,
                            submenu('chat-move', t('moveToProject'), itemsOf('chat-move', context, command), !context.chatWorking)
                        )
                }
            ]
        },
        { id: 'settings' },
        { id: 'delete' }
    ],
    'chat-move': [
        {
            id: 'recent',
            extras: [
                { order: 10, build: (context, command) => context.moveProjects.map((project) => command(`${CHAT_MOVE_PREFIX}${project.id}`, project.name)) }
            ]
        },
        { id: 'other' }
    ],
    layouts: [
        { id: 'save' },
        { id: 'apply', extras: [{ order: 10, build: (context, command) => context.layouts.map((name) => command(`layout-apply-${name}`, name)) }] },
        {
            id: 'delete',
            extras: [
                {
                    order: 10,
                    build: (context, command) =>
                        only(
                            context.layouts.length > 0,
                            submenu(
                                'delete-layout',
                                t('deleteLayout'),
                                context.layouts.map((name) => command(`layout-delete-${name}`, name))
                            )
                        )
                }
            ]
        }
    ],
    window: [
        {
            id: 'window',
            extras: [
                {
                    order: 10,
                    build: (context) => [
                        ...only(isDesktop(context), role('minimize', t('minimize'))),
                        ...only(isDesktop(context) && context.apple, role('zoom', t('zoom')))
                    ]
                }
            ]
        },
        { id: 'panels' },
        { id: 'front', extras: [{ order: 10, build: (context) => only(isDesktop(context) && context.apple, role('front', t('front'))) }] }
    ],
    run: [
        { id: 'launch' },
        {
            id: 'choose',
            extras: [
                {
                    order: 10,
                    build: (context, command) =>
                        context.launches.map((launch) =>
                            command(`${LAUNCH_CHOOSE_PREFIX}${launch.id}`, launch.name, { checked: launch.id === context.chosenLaunch, radio: true })
                        )
                }
            ]
        },
        {
            id: 'setup',
            extras: [
                {
                    order: 10,
                    build: (context, command) =>
                        only(
                            context.afterSettle.tasks.length > 0,
                            submenu('launches-after-settle', t('launchesAfterSettle'), itemsOf('launches-after-settle', context, command))
                        )
                }
            ]
        }
    ],
    'launches-after-settle': [
        { id: 'off' },
        {
            id: 'tasks',
            extras: [
                {
                    order: 10,
                    build: (context, command) =>
                        context.afterSettle.tasks.map((task) =>
                            command(`${AFTER_SETTLE_PREFIX}${task.id}`, task.name, { checked: task.id === context.afterSettle.chosen, radio: true })
                        )
                }
            ]
        }
    ],
    help: [{ id: 'help' }, { id: 'about' }]
};

interface PlacedCommand {
    id: TableCommandId;
    place: MenuPlace;
}

/* The table's rows per container and group, in their order. */
const PLACED = new Map<string, PlacedCommand[]>();
for (const id of COMMAND_IDS) {
    for (const place of menuPlacesOf(id)) {
        const at = `${place.menu}/${place.group}`;
        PLACED.set(at, [...(PLACED.get(at) ?? []), { id, place }]);
    }
}
for (const rows of PLACED.values()) {
    rows.sort((one, other) => one.place.order - other.place.order);
}

function shortcutOf(shortcut: Shortcut | undefined, place: MenuPlace, context: MenuContext): Shortcut | undefined {
    if (place.shortcut) {
        return place.shortcut(context);
    }
    return (place.showsShortcut?.(context) ?? true) ? shortcut : undefined;
}

function tableRow({ id, place }: PlacedCommand, context: MenuContext, command: MenuCommand): MenuNode {
    const spec = COMMANDS[id];
    const words = place.words?.(context) ?? { key: spec.key };
    const enabled = place.enabled?.(context);
    return command(id, t(words.key, words.values), {
        shortcut: shortcutOf(spec.shortcut, place, context),
        ...(enabled === undefined ? {} : { enabled }),
        checked: place.checked?.(context),
        radio: place.radio === true
    });
}

/* The rows of a menu or submenu, a line before every group but the first; `tidy` drops the lines empty groups leave. */
function itemsOf(container: MenuContainer, context: MenuContext, command: MenuCommand): MenuNode[] {
    return LAYOUT[container].flatMap((group, index) => {
        if (group.when && !group.when(context)) {
            return [];
        }
        const rows = (PLACED.get(`${container}/${group.id}`) ?? [])
            .filter(({ place }) => place.when?.(context) ?? true)
            .map((placed) => ({ order: placed.place.order, nodes: [tableRow(placed, context, command)] }));
        const extras = (group.extras ?? []).map((extra) => ({ order: extra.order, nodes: extra.build(context, command) }));
        const nodes = [...rows, ...extras].sort((one, other) => one.order - other.order).flatMap((entry) => entry.nodes);
        return index === 0 ? nodes : [separator, ...nodes];
    });
}

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
    const command: MenuCommand = (id, label, options = {}) => {
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

    const section = (container: MenuContainer, label: string, id: string = container): MenuSection => ({
        id,
        label,
        items: itemsOf(container, context, command)
    });
    const kind = workspace ? context.view : null;
    const menus = [
        ...(apple && desktop ? [section('app', 'Ruimte')] : []),
        section('file', t('file')),
        section('edit', t('edit')),
        ...(workspace && !context.settingsOpen ? [section('code', t('code'))] : []),
        section('view', t('view')),
        // The menu of the view with the focus, named after its kind, so everything a drawing offers sits in one place.
        ...(kind !== null && KIND_MENUS.includes(kind) ? [section('kind', t(`kinds.${kind}`), `kind-${kind}`)] : []),
        section('go', t('go')),
        ...(workspace && !context.scratch ? [section('run', t('run'))] : []),
        // The roles are where macOS lists the open windows and puts its search field.
        { ...section('window', t('window')), role: 'window' as const },
        { ...section('help', t('help')), role: 'help' as const }
    ];
    return { menus: menus.map((menu) => ({ ...menu, items: tidy(menu.items) })) };
}
