import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MenuNode, MenuSpec } from '@ruimte/desktop-bridge';
import { CANVAS_SHORTCUTS, ADD_NODE_SHORTCUTS } from '@/canvas/shortcuts';
import { menuIconOf } from './icons';
import { GO_VIEW_PREFIX, isPaletteId, MENU_ACTION_IDS, PALETTE_IDS } from './ids';
import { menuModel, toAccelerator, type MenuContext } from './model';

const NO_OFFERS = {
    duplicate: false,
    openInChat: false,
    openInTerminal: false,
    fork: false,
    putOnCanvas: false,
    showOnCanvas: false,
    reveal: false,
    share: false
};

const context = (patch: Partial<MenuContext> = {}): MenuContext => ({
    host: 'desktop',
    apple: true,
    workspace: true,
    folder: true,
    fileManager: 'Finder',
    view: 'canvas',
    offers: { ...NO_OFFERS, duplicate: true, share: true },
    shared: false,
    selection: 0,
    promote: false,
    anyLocked: false,
    cells: 1,
    split: { right: true, down: true },
    maximized: false,
    closesRight: false,
    panel: null,
    sidebar: true,
    views: ['Main', 'Sketch'],
    moveTargets: [],
    layouts: ['Review'],
    agents: [{ kind: 'claude', name: 'Claude Code', chat: true, terminal: true }],
    releaseNotes: true,
    fullscreen: false,
    keepAwake: null,
    ...patch
});

const START_SCREEN = context({ workspace: false, folder: false, view: null, offers: null, views: [], layouts: [], cells: 1 });

const labels = (spec: MenuSpec): string[] => spec.menus.map((menu) => menu.label);

const menu = (spec: MenuSpec, label: string): MenuNode[] => spec.menus.find((candidate) => candidate.label === label)?.items ?? [];

const flatten = (nodes: readonly MenuNode[]): MenuNode[] => nodes.flatMap((node) => (node.kind === 'submenu' ? [node, ...flatten(node.items)] : [node]));

const commandIds = (spec: MenuSpec): string[] =>
    spec.menus.flatMap((entry) => flatten(entry.items)).flatMap((node) => (node.kind === 'command' ? [node.id] : []));

const find = (spec: MenuSpec, id: string): Extract<MenuNode, { kind: 'command' }> | undefined =>
    spec.menus
        .flatMap((entry) => flatten(entry.items))
        .find((node): node is Extract<MenuNode, { kind: 'command' }> => node.kind === 'command' && node.id === id);

const EVERY_CONTEXT: MenuContext[] = [
    START_SCREEN,
    ...(['canvas', 'drawing', 'diagram', 'chat', 'terminal', 'browser', 'file'] as const).flatMap((view) =>
        [true, false].flatMap((apple) =>
            (['desktop', 'station'] as const).map((host) =>
                context({
                    view,
                    apple,
                    host,
                    offers: { ...NO_OFFERS, duplicate: true, fork: true, openInChat: true, openInTerminal: true, putOnCanvas: true, reveal: true, share: true },
                    moveTargets: [{ id: 'v2', name: 'Other' }],
                    cells: 2
                })
            )
        )
    )
];

describe('the menus', () => {
    test('macOS opens on the application menu, and the view with the focus names the fifth', () => {
        expect(labels(menuModel(context()))).toEqual(['Ruimte', 'File', 'Edit', 'View', 'Canvas', 'Go', 'Window', 'Help']);
        expect(labels(menuModel(context({ view: 'drawing' })))).toEqual(['Ruimte', 'File', 'Edit', 'View', 'Drawing', 'Go', 'Window', 'Help']);
        expect(labels(menuModel(context({ view: 'chat' })))).toEqual(['Ruimte', 'File', 'Edit', 'View', 'Chat', 'Go', 'Window', 'Help']);
    });

    test('off macOS Settings sits in File and About in Help', () => {
        const spec = menuModel(context({ apple: false }));
        expect(labels(spec)).toEqual(['File', 'Edit', 'View', 'Canvas', 'Go', 'Window', 'Help']);
        expect(flatten(menu(spec, 'File')).some((node) => node.kind === 'command' && node.id === 'settings')).toBe(true);
        expect(flatten(menu(spec, 'File')).some((node) => node.kind === 'role' && node.role === 'quit')).toBe(true);
        expect(flatten(menu(spec, 'Help')).some((node) => node.kind === 'command' && node.id === 'about')).toBe(true);
    });

    test('the start screen has no view menu and nothing that needs a project', () => {
        const spec = menuModel(START_SCREEN);
        expect(labels(spec)).toEqual(['Ruimte', 'File', 'Edit', 'View', 'Go', 'Window', 'Help']);
        const ids = commandIds(spec);
        expect(ids).toContain('open-folder');
        expect(ids).toContain('palette');
        for (const id of ['view-new', 'find-in-files', 'sidebar', 'split-right', 'view-previous', 'panel-processes', 'fit']) {
            expect(ids).not.toContain(id);
        }
    });

    test('the station has no shell, no clipboard roles and no release notes', () => {
        const spec = menuModel(context({ host: 'station', apple: true, releaseNotes: false }));
        expect(labels(spec)).toEqual(['File', 'Edit', 'View', 'Canvas', 'Go', 'Window', 'Help']);
        const nodes = spec.menus.flatMap((entry) => flatten(entry.items));
        expect(nodes.some((node) => node.kind === 'role' || node.kind === 'shell')).toBe(false);
        expect(commandIds(spec)).toContain('about');
        expect(commandIds(spec)).toContain('close-cell');
        expect(commandIds(spec)).not.toContain('release-notes');
    });

    test('the station prints its keys, except the ones a browser tab keeps, and undoes its own history', () => {
        const spec = menuModel(context({ host: 'station', apple: true, cells: 2 }));
        expect(find(spec, 'palette')).toMatchObject({ keys: '⌘K' });
        expect(find(spec, 'palette')?.accelerator).toBeUndefined();
        expect(find(spec, 'close-cell')?.keys).toBeUndefined();
        expect(find(spec, 'view-new')?.keys).toBeUndefined();
        expect(find(spec, 'edit-undo')).toMatchObject({ keys: '⌘Z', enabled: true });
        expect(find(spec, 'fullscreen')?.checked).toBe(false);
        expect(find(menuModel(context({ host: 'station', view: 'terminal' })), 'edit-undo')?.enabled).toBe(false);
    });

    test('a terminal can be cleared and the project has its settings in File', () => {
        const spec = menuModel(context({ view: 'terminal' }));
        expect(menu(spec, 'Terminal').some((node) => node.kind === 'command' && node.id === 'terminal-clear')).toBe(true);
        expect(menu(spec, 'File').some((node) => node.kind === 'command' && node.id === 'project-settings')).toBe(true);
        expect(commandIds(menuModel(START_SCREEN))).not.toContain('project-settings');
    });

    test('Cmd+W closes the window with one cell and the cell with more', () => {
        const one = menu(menuModel(context({ cells: 1 })), 'File');
        expect(one.some((node) => node.kind === 'role' && node.role === 'close')).toBe(true);
        expect(one.some((node) => node.kind === 'command' && node.id === 'close-cell')).toBe(false);
        const two = menuModel(context({ cells: 2 }));
        expect(find(two, 'close-cell')?.accelerator).toBe('CommandOrControl+W');
    });

    test('what waits on a selection or a split is greyed rather than gone', () => {
        const spec = menuModel(context({ selection: 0, split: { right: false, down: true }, cells: 1 }));
        expect(find(spec, 'group-selection')?.enabled).toBe(false);
        expect(find(spec, 'view-promote')?.enabled).toBe(false);
        expect(find(spec, 'split-right')?.enabled).toBe(false);
        expect(find(spec, 'split-down')?.enabled).toBe(true);
        expect(find(spec, 'focus-left')?.enabled).toBe(false);
        expect(find(menuModel(context({ selection: 2 })), 'group-selection')?.enabled).toBe(true);
    });

    test('a cell maximizes from View while the grid has more than one, and says so while it does', () => {
        expect(find(menuModel(context({ cells: 1 })), 'cell-maximize')?.enabled).toBe(false);
        const two = find(menuModel(context({ cells: 2, maximized: true })), 'cell-maximize');
        expect(two).toMatchObject({ enabled: true, checked: true, accelerator: 'CommandOrControl+Shift+Enter' });
    });

    test('closing the other cells or those to the right sits under Close, greyed while there is nothing to close', () => {
        const one = menuModel(context({ cells: 1 }));
        expect(find(one, 'cell-close-others')?.enabled).toBe(false);
        expect(find(one, 'cell-close-right')?.enabled).toBe(false);
        const three = menuModel(context({ cells: 3, closesRight: true }));
        expect(find(three, 'cell-close-others')?.enabled).toBe(true);
        expect(find(three, 'cell-close-right')?.enabled).toBe(true);
        expect(commandIds(menuModel(START_SCREEN))).not.toContain('cell-close-others');
    });

    test('keeping the Mac awake is a choice of three under Settings, with the one in force marked', () => {
        const spec = menuModel(context({ keepAwake: 'working' }));
        const app = menu(spec, 'Ruimte');
        const keepAwake = app[app.findIndex((node) => node.kind === 'command' && node.id === 'settings') + 1];
        expect(keepAwake).toMatchObject({ kind: 'submenu', id: 'keep-awake', label: 'Keep This Computer Awake' });
        const choices = keepAwake?.kind === 'submenu' ? keepAwake.items : [];
        expect(choices).toEqual([
            { kind: 'command', id: 'keep-awake-off', label: 'Off', checked: false, radio: true },
            { kind: 'command', id: 'keep-awake-working', label: 'While Agents Work', checked: true, radio: true },
            { kind: 'command', id: 'keep-awake-always', label: 'Always', checked: false, radio: true }
        ]);
    });

    test('where the shell cannot hold the Mac awake the choice is not offered', () => {
        expect(commandIds(menuModel(context()))).not.toContain('keep-awake-off');
    });

    test('zoom is offered on every view and only works where there is a camera', () => {
        expect(find(menuModel(context({ view: 'drawing' })), 'fit')?.enabled).toBe(true);
        expect(find(menuModel(context({ view: 'terminal' })), 'fit')?.enabled).toBe(false);
    });

    test('the panels and the sidebar are check marks, Processes sits in Window', () => {
        const spec = menuModel(context({ panel: 'processes', sidebar: false }));
        expect(find(spec, 'sidebar')?.checked).toBe(false);
        expect(find(spec, 'panel-files')?.checked).toBe(false);
        expect(menu(spec, 'Window').some((node) => node.kind === 'command' && node.id === 'panel-processes' && node.checked === true)).toBe(true);
    });

    test('Compare Models sits in Window right under Usage, on the start screen and in a workspace, and not in the palette', () => {
        for (const spec of EVERY_CONTEXT.map(menuModel)) {
            const ids = menu(spec, 'Window').flatMap((node) => (node.kind === 'command' ? [node.id] : []));
            expect(ids[ids.indexOf('usage') + 1]).toBe('models');
            expect(find(spec, 'models')?.accelerator).toBeUndefined();
            expect(find(spec, 'models')?.keys).toBeUndefined();
        }
        expect(isPaletteId('models')).toBe(false);
        expect(readFileSync(join(import.meta.dir, '..', 'commands.ts'), 'utf8')).not.toContain("id: 'models'");
    });

    test('each kind has its own rows, and every kind ends on its settings and its delete', () => {
        const drawing = commandIds(menuModel(context({ view: 'drawing' })));
        expect(drawing).toContain('drawing-save-png');
        expect(drawing).not.toContain('add-terminal');
        const chat = menu(menuModel(context({ view: 'chat', offers: { ...NO_OFFERS, fork: true, openInTerminal: true } })), 'Chat');
        expect(chat.flatMap((node) => (node.kind === 'command' ? [node.id] : []))).toEqual([
            'view-fork',
            'view-open-in-terminal',
            'flag-toggle',
            'view-settings',
            'view-delete'
        ]);
    });

    test('the Go menu names the first nine views with their shortcut', () => {
        const spec = menuModel(context({ views: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] }));
        const views = menu(spec, 'Go').filter((node) => node.kind === 'command' && node.id.startsWith(GO_VIEW_PREFIX));
        expect(views).toHaveLength(9);
        expect(views[0]).toMatchObject({ label: 'A', accelerator: 'CommandOrControl+1' });
    });

    test('no menu starts or ends on a line or draws two in a row', () => {
        for (const spec of EVERY_CONTEXT.map(menuModel)) {
            const lists = [
                ...spec.menus.map((entry) => entry.items),
                ...spec.menus.flatMap((entry) => flatten(entry.items)).flatMap((node) => (node.kind === 'submenu' ? [node.items] : []))
            ];
            for (const items of lists) {
                expect(items[0]?.kind).not.toBe('separator');
                expect(items.at(-1)?.kind).not.toBe('separator');
                expect(items.some((node, index) => node.kind === 'separator' && items[index + 1]?.kind === 'separator')).toBe(false);
            }
        }
    });
});

describe('the commands behind the menu', () => {
    test('every id in any menu has a handler', () => {
        const ids = new Set(EVERY_CONTEXT.flatMap((entry) => commandIds(menuModel(entry))));
        for (const id of ids) {
            const handled = (MENU_ACTION_IDS as readonly string[]).includes(id) || isPaletteId(id) || id.startsWith(GO_VIEW_PREFIX);
            expect(handled ? id : `${id} has no handler`).toBe(id);
        }
    });

    test('every palette id the menu borrows is a row of the palette', () => {
        const source = readFileSync(join(import.meta.dir, '..', 'commands.ts'), 'utf8');
        for (const id of PALETTE_IDS) {
            expect(source.includes(`id: '${id}'`) ? id : `${id} is not in appCommands()`).toBe(id);
        }
        for (const row of [
            '`agent-${target}-${provider.kind}`',
            '`agent-view-${target}-${provider.kind}`',
            '`layout-apply-${layout.name}`',
            '`layout-delete-${layout.name}`',
            '`view-move-${view.id}`'
        ]) {
            expect(source).toContain(row);
        }
    });
});

describe('the menu the web client draws', () => {
    test('every row and every submenu has an icon, so the labels start on one line', () => {
        const stations = EVERY_CONTEXT.filter((entry) => entry.host === 'station').map(menuModel);
        for (const spec of stations) {
            const ids = [
                ...spec.menus.map((entry) => entry.id),
                ...spec.menus.flatMap((entry) => flatten(entry.items)).flatMap((node) => (node.kind === 'command' || node.kind === 'submenu' ? [node.id] : []))
            ];
            for (const id of ids) {
                expect(menuIconOf(id) === null ? `${id} has no icon` : id).toBe(id);
            }
        }
    });
});

describe('accelerators', () => {
    test('Mod is Cmd on macOS and Ctrl elsewhere, named keys the way Electron spells them', () => {
        expect(toAccelerator(CANVAS_SHORTCUTS.previousView, true)).toBe('CommandOrControl+Shift+[');
        expect(toAccelerator(CANVAS_SHORTCUTS.togglePanel, false)).toBe('CommandOrControl+Alt+B');
        expect(toAccelerator(CANVAS_SHORTCUTS.splitRight, true)).toBe('CommandOrControl+\\');
    });

    test('on macOS a key without Cmd or Ctrl gets none, since the menu would take it from every text field', () => {
        expect(toAccelerator(ADD_NODE_SHORTCUTS.terminal, true)).toBeUndefined();
        expect(toAccelerator(CANVAS_SHORTCUTS.fitAll, true)).toBeUndefined();
        expect(toAccelerator(ADD_NODE_SHORTCUTS.terminal, false)).toBe('Alt+T');
    });
});
