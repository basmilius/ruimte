import i18next from 'i18next';
import type { ProjectView } from '@ruimte/contracts';
import type { MenuNode, MenuRole, MenuShellAction, MenuSpec } from '@ruimte/desktop-bridge';
import { ADD_NODE_SHORTCUTS, CANVAS_SHORTCUTS, FOCUS_SHORTCUTS, viewShortcut } from '@/canvas/shortcuts';
import { APP_SHORTCUTS, BROWSER_KEEPS } from '@/shell/shortcuts';
import type { ViewOffers } from '@/shell/view-offers';
import type { PanelKind } from '@/state/ui';
import { formatShortcut, type Shortcut } from '@/ui/shortcut';
import { GO_VIEW_PREFIX, type MenuActionId, type PaletteId } from '@/shell/menu/ids';

export type MenuHost = 'desktop' | 'station';

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
    folder: boolean;
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
    split: { right: boolean; down: boolean };
    /* The open panel, or null while none is. */
    panel: PanelKind | null;
    sidebar: boolean;
    /* The openable views in sidebar order; the first nine have a shortcut. */
    views: string[];
    moveTargets: { id: string; name: string }[];
    layouts: string[];
    agents: MenuAgent[];
    releaseNotes: boolean;
    /* The page fills the screen, which only the web client asks the page itself. */
    fullscreen: boolean;
}

type CommandId = MenuActionId | PaletteId;

interface CommandOptions {
    shortcut?: Shortcut;
    enabled?: boolean;
    checked?: boolean;
}

const t = (key: string, options?: Record<string, unknown>): string => i18next.t(`shell:menu.${key}`, options ?? {});

const ELECTRON_KEYS: Record<string, string> = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', '+': 'Plus' };

/*
 * The accelerator the shell shows next to an item. On macOS a menu shows only what it also binds, and
 * a key without Cmd or Ctrl would be taken from every text field, so those get none there.
 */
export const toAccelerator = (shortcut: Shortcut, apple: boolean): string | undefined => {
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
};

const sameShortcut = (one: Shortcut, other: Shortcut): boolean =>
    one.key === other.key && one.mod === other.mod && one.ctrl === other.ctrl && one.meta === other.meta && one.alt === other.alt && one.shift === other.shift;

const separator: MenuNode = { kind: 'separator' };

const role = (name: MenuRole, label: string): MenuNode => ({ kind: 'role', role: name, label });

const shell = (action: MenuShellAction, label: string): MenuNode => ({ kind: 'shell', action, label });

const submenu = (id: string, label: string, items: MenuNode[], enabled?: boolean): MenuNode => ({
    kind: 'submenu',
    id,
    label,
    items: tidy(items),
    ...(enabled === undefined ? {} : { enabled })
});

/* No line at either end and never two in a row, so a group that is not offered takes its line with it. */
export const tidy = (items: MenuNode[]): MenuNode[] =>
    items.filter(
        (item, index) =>
            item.kind !== 'separator' ||
            (index > 0 &&
                index < items.length - 1 &&
                items[index - 1]!.kind !== 'separator' &&
                items.slice(index + 1).some((next) => next.kind !== 'separator'))
    );

const only = (condition: boolean, ...items: MenuNode[]): MenuNode[] => (condition ? items : []);

const ZOOMABLE: readonly ProjectView['kind'][] = ['canvas', 'drawing', 'diagram'];

/* The kinds a cell shows with a menu of their own; a divider never has the focus and an unknown kind offers nothing. */
const KIND_MENUS: readonly ProjectView['kind'][] = ['canvas', 'drawing', 'diagram', 'chat', 'terminal', 'browser', 'file'];

/* The application menu for one moment: which view has the focus, what is selected, where it runs. */
export const menuModel = (context: MenuContext): MenuSpec => {
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
            ...(options.checked === undefined ? {} : { checked: options.checked })
        };
    };

    const appMenu = {
        id: 'app',
        label: 'Ruimte',
        items: [
            command('about', t('about')),
            separator,
            command('settings', t('settings'), { shortcut: APP_SHORTCUTS.settings }),
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
    const close =
        context.cells > 1 || !desktop
            ? command('close-cell', t('closeCell'), { shortcut: CANVAS_SHORTCUTS.closeCell, enabled: context.cells > 1 })
            : role('close', t('closeWindow'));
    const fileMenu = {
        id: 'file',
        label: t('file'),
        items: [
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
            ...only(workspace && context.folder, command('reveal', t('reveal', { app: context.fileManager }))),
            ...only(workspace, command('project-settings', t('projectSettings'))),
            separator,
            ...only(workspace || desktop, close),
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
            ...only(workspace && context.folder, command('find-in-files', t('findInFiles'), { shortcut: APP_SHORTCUTS.findInFiles }))
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
                command('panel-files', t('files'), { checked: context.panel === 'files' }),
                command('panel-git', t('git'), { checked: context.panel === 'git' }),
                command('panel-devices', t('devices'), { checked: context.panel === 'devices' }),
                command('panel-toggle', t('togglePanel'), { shortcut: CANVAS_SHORTCUTS.togglePanel }),
                separator,
                command('split-right', t('splitRight'), { shortcut: CANVAS_SHORTCUTS.splitRight, enabled: context.split.right }),
                command('split-down', t('splitDown'), { shortcut: CANVAS_SHORTCUTS.splitDown, enabled: context.split.down }),
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
                separator,
                ...context.views.slice(0, 9).map((name, index) => command(`${GO_VIEW_PREFIX}${index + 1}`, name, { shortcut: viewShortcut(index) })),
                separator,
                command('focus-left', t('focusLeft'), { shortcut: FOCUS_SHORTCUTS.left, enabled: context.cells > 1 }),
                command('focus-right', t('focusRight'), { shortcut: FOCUS_SHORTCUTS.right, enabled: context.cells > 1 }),
                command('focus-up', t('focusUp'), { shortcut: FOCUS_SHORTCUTS.up, enabled: context.cells > 1 }),
                command('focus-down', t('focusDown'), { shortcut: FOCUS_SHORTCUTS.down, enabled: context.cells > 1 }),
                separator,
                command('prompts', t('prompts'), { shortcut: CANVAS_SHORTCUTS.focusPrompts })
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
            command('usage', t('usage')),
            command('settings-machines', t('machines')),
            ...only(desktop && apple, separator, role('front', t('front')))
        ]
    };

    const helpMenu = {
        id: 'help',
        label: t('help'),
        items: [
            ...only(context.releaseNotes, command('release-notes', t('releaseNotes'))),
            command('settings-keyboard', t('keyboardShortcuts')),
            ...only(!apple || !desktop, separator, command('about', t('about')))
        ]
    };

    const kindMenu = workspace && context.view !== null ? viewKindMenu(context, command) : null;
    const menus = [...(apple && desktop ? [appMenu] : []), fileMenu, editMenu, viewMenu, ...(kindMenu ? [kindMenu] : []), goMenu, windowMenu, helpMenu];
    return { menus: menus.map((menu) => ({ id: menu.id, label: menu.label, items: tidy(menu.items) })) };
};

/* The menu of the view with the focus, named after its kind, so everything a drawing offers sits in one place. */
const viewKindMenu = (
    context: MenuContext,
    command: (id: CommandId | string, label: string, options?: CommandOptions) => MenuNode
): { id: string; label: string; items: MenuNode[] } | null => {
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
            command('view-settings', t('viewSettings')),
            separator,
            command('view-delete', t('deleteView'))
        ]
    };
};
