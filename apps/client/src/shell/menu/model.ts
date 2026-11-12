import { formatShortcut, type Shortcut } from '@adecore/ui';
import type { ProjectView } from '@ruimte/contracts';
import type { MenuNode, MenuSpec } from '@ruimte/desktop-bridge';
import { editorAvailable, desktop as isDesktop, onCanvas, severalCells } from '@/commands/conditions';
import { only, role, separator, shell, submenu, t, tidy, type CommandOptions, type MenuCommand } from '@/commands/menu-builders';
import type { MenuContext, MenuHost } from '@/commands/menu-context';
import { menuExtrasOf } from '@/commands/menu-extras';
import { commandIds, commandKey, commandSpec, menuPlacesOf } from '@/commands/registry';
import type { MenuContainer, MenuPlace } from '@/commands/types';
import { BROWSER_KEEPS } from '@/surface/shortcuts';

export type { MenuContext, MenuHost };
export { tidy };

type MenuSection = MenuSpec['menus'][number];

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

/* What a group draws besides the rows of the command table: a role, or a submenu of the window itself. Features add theirs (`commands/menu-extras.ts`). */
interface MenuExtra {
    readonly order: number;
    readonly build: (context: MenuContext, command: MenuCommand) => MenuNode[];
}

/* A run of rows between two lines. Rows of the table say they belong to it (`MenuPlace`). */
interface MenuGroup {
    readonly id: string;
    readonly when?: (context: MenuContext) => boolean;
    readonly extras?: readonly MenuExtra[];
}

function inWorkspace(context: MenuContext): boolean {
    return context.workspace;
}

function submenuOf(container: MenuContainer, key: string): MenuExtra['build'] {
    return (context, command) => [submenu(container, t(key), itemsOf(container, context, command))];
}

function quitRows(): MenuNode[] {
    return [shell('stop-machine-and-quit', t('stopAndQuit')), role('quit', t('quit'))];
}

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
    'new-view': [{ id: 'views' }, { id: 'agents' }, { id: 'dividers' }],
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
        {
            id: 'lines',
            when: (context) => context.workspace && !context.settingsOpen && editorAvailable(context),
            extras: [
                { order: 10, build: submenuOf('edit-lines', 'lines') },
                { order: 20, build: submenuOf('selection', 'selection') }
            ]
        },
        { id: 'search' }
    ],
    'edit-lines': [{ id: 'lines' }],
    selection: [{ id: 'selection' }],
    // The rows that change text as text sit under Edit, so Code keeps what knows the code.
    code: [
        { id: 'pull-request', when: (context) => context.folder && !context.scratch },
        { id: 'pr-watch' },
        { id: 'language', when: editorAvailable, extras: [{ order: -1, build: submenuOf('completion', 'codeCompletion') }] },
        {
            id: 'submenus',
            when: editorAvailable,
            extras: [
                { order: 10, build: submenuOf('ai', 'ai') },
                { order: 20, build: submenuOf('templates', 'templates') }
            ]
        },
        { id: 'editor', when: editorAvailable, extras: [{ order: 1000, build: submenuOf('folding', 'folding') }] }
    ],
    completion: [{ id: 'completion' }],
    ai: [{ id: 'ai' }],
    templates: [{ id: 'templates' }],
    folding: [{ id: 'folding', extras: [{ order: 1000, build: submenuOf('expand-to-level', 'expandAllToLevel') }] }],
    'expand-to-level': [{ id: 'levels' }],
    go: [
        { id: 'palette' },
        { id: 'views', when: inWorkspace },
        { id: 'go-view', when: inWorkspace },
        { id: 'focus', when: (context) => context.workspace && severalCells(context) },
        { id: 'nodes', when: (context) => context.workspace && context.view === 'canvas' },
        { id: 'prompts', when: inWorkspace },
        { id: 'language', when: (context) => context.workspace && !context.settingsOpen },
        { id: 'editor-navigation', when: (context) => context.workspace && !context.settingsOpen }
    ],
    kind: [
        { id: 'canvas-add', when: onCanvas },
        { id: 'canvas-arrange', when: onCanvas },
        { id: 'canvas-layout', when: onCanvas },
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
        { id: 'place' },
        { id: 'settings' },
        { id: 'delete' }
    ],
    'chat-move': [{ id: 'recent' }, { id: 'other' }],
    layouts: [{ id: 'save' }, { id: 'apply' }, { id: 'delete' }],
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
    run: [{ id: 'launch' }, { id: 'choose' }, { id: 'setup' }],
    'launches-after-settle': [{ id: 'off' }, { id: 'tasks' }],
    help: [{ id: 'help' }, { id: 'about' }]
};

interface PlacedCommand {
    id: string;
    place: MenuPlace;
}

let placedFor = -1;
let placed = new Map<string, PlacedCommand[]>();

function placedRows(): Map<string, PlacedCommand[]> {
    const ids = commandIds();
    if (placedFor === ids.length) {
        return placed;
    }
    placed = new Map();
    for (const id of ids) {
        for (const place of menuPlacesOf(id)) {
            const at = `${place.menu}/${place.group}`;
            placed.set(at, [...(placed.get(at) ?? []), { id, place }]);
        }
    }
    for (const rows of placed.values()) {
        rows.sort((one, other) => one.place.order - other.place.order);
    }
    placedFor = ids.length;

    return placed;
}
function shortcutOf(shortcut: Shortcut | undefined, place: MenuPlace, context: MenuContext): Shortcut | undefined {
    if (place.shortcut) {
        return place.shortcut(context);
    }
    return (place.showsShortcut?.(context) ?? true) ? shortcut : undefined;
}

function tableRow({ id, place }: PlacedCommand, context: MenuContext, command: MenuCommand): MenuNode {
    const spec = commandSpec(id);
    const words = place.words?.(context) ?? { key: spec.key };
    const enabled = place.enabled?.(context);
    return command(id, t(words.key, words.values), {
        shortcut: shortcutOf(commandKey(id), place, context),
        ...(enabled === undefined ? {} : { enabled }),
        checked: place.checked?.(context),
        radio: place.radio === true
    });
}

function itemsOf(container: MenuContainer, context: MenuContext, command: MenuCommand): MenuNode[] {
    return LAYOUT[container].flatMap((group, index) => {
        if (group.when && !group.when(context)) {
            return [];
        }
        const rows = (placedRows().get(`${container}/${group.id}`) ?? [])
            .filter(({ place }) => place.when?.(context) ?? true)
            .map((placed) => ({ order: placed.place.order, nodes: [tableRow(placed, context, command)] }));
        const own = (group.extras ?? []).map((extra) => ({ order: extra.order, nodes: extra.build(context, command) }));
        const contributed = menuExtrasOf(container, group.id).map((extra) => ({
            order: extra.order,
            nodes: extra.build(context, command, (inner) => itemsOf(inner, context, command))
        }));
        const extras = [...own, ...contributed];
        const nodes = [...rows, ...extras].sort((one, other) => one.order - other.order).flatMap((entry) => entry.nodes);
        return index === 0 ? nodes : [separator, ...nodes];
    });
}

/* The kinds a cell shows with a menu of their own; a divider never has the focus and an unknown kind offers nothing. */
const KIND_MENUS: readonly ProjectView['kind'][] = ['canvas', 'drawing', 'diagram', 'chat', 'terminal', 'browser', 'file'];

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
    // A menu with nothing to offer here, such as Code without an editor or a pull request, leaves the bar.
    return { menus: menus.map((menu) => ({ ...menu, items: tidy(menu.items) })).filter((menu) => menu.items.length > 0 || menu.role !== undefined) };
}
