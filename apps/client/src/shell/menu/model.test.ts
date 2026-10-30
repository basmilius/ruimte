import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MenuNode, MenuSpec } from '@ruimte/desktop-bridge';
import { CANVAS_SHORTCUTS, ADD_NODE_SHORTCUTS } from '@/canvas/shortcuts';
import { menuIconOf } from './icons';
import { LANGUAGE_COMMAND_IDS } from '@/language/command-table';
import { COMMAND_IDS, COMMANDS, isCommandId, menuPlacesOf } from '@/shell/command-table';
import { languageCommandRows } from '@/language/language-commands';
import { EDITOR_COMMAND_IDS, editorCommandRows } from '@/shell/editor-commands';
import { AFTER_SETTLE_PREFIX, CHAT_MOVE_PREFIX, GO_VIEW_PREFIX, isPaletteId, LAUNCH_CHOOSE_PREFIX } from './ids';
import { menuModel, toAccelerator, type MenuContext } from './model';

const NO_OFFERS = {
    duplicate: false,
    openInChat: false,
    openInTerminal: false,
    fork: false,
    putOnCanvas: false,
    showOnCanvas: false,
    reveal: false,
    share: false,
    makeProject: false,
    moveToProject: false
};

function context(patch: Partial<MenuContext> = {}): MenuContext {
    return {
        host: 'desktop',
        apple: true,
        workspace: true,
        folder: true,
        fileManager: 'Finder',
        view: 'canvas',
        offers: { ...NO_OFFERS, duplicate: true, share: true },
        chatWorking: false,
        moveProjects: [],
        shared: false,
        selection: 0,
        promote: false,
        groupArrangeable: false,
        anyLocked: false,
        cells: 1,
        tabs: { hosted: false, count: 0, index: 0, splitOff: false },
        split: { right: true, down: true },
        maximized: false,
        nodeMaximizable: false,
        nodeMaximized: false,
        nodeZoomable: false,
        closesRight: false,
        panel: null,
        sidebar: true,
        views: ['Main', 'Sketch'],
        navigation: {
            views: false,
            camera: { back: false, forward: false },
            focus: { left: false, right: false, up: false, down: false },
            nodes: { left: false, right: false, up: false, down: false },
            prompts: false,
            waiting: false,
            editor: false,
            language: false
        },
        moveTargets: [],
        layouts: ['Review'],
        agents: [{ kind: 'claude', name: 'Claude Code', chat: true, terminal: true }],
        launches: [],
        chosenLaunch: null,
        afterSettle: { tasks: [], chosen: null },
        releaseNotes: true,
        fullscreen: false,
        keepAwake: null,
        settingsOpen: false,
        windows: true,
        newChat: true,
        localMachine: true,
        scratch: false,
        prWatch: false,
        routines: false,
        chat: false,
        terminalKeys: false,
        terminalFind: false,
        diff: false,
        prRepos: [],
        ...patch
    };
}

const START_SCREEN = context({ workspace: false, folder: false, view: null, offers: null, views: [], layouts: [], cells: 1 });

function labels(spec: MenuSpec): string[] {
    return spec.menus.map((menu) => menu.label);
}

function menu(spec: MenuSpec, label: string): MenuNode[] {
    return spec.menus.find((candidate) => candidate.label === label)?.items ?? [];
}

function flatten(nodes: readonly MenuNode[]): MenuNode[] {
    return nodes.flatMap((node) => (node.kind === 'submenu' ? [node, ...flatten(node.items)] : [node]));
}

function commandIds(spec: MenuSpec): string[] {
    return spec.menus.flatMap((entry) => flatten(entry.items)).flatMap((node) => (node.kind === 'command' ? [node.id] : []));
}

function find(spec: MenuSpec, id: string): Extract<MenuNode, { kind: 'command' }> | undefined {
    return spec.menus
        .flatMap((entry) => flatten(entry.items))
        .find((node): node is Extract<MenuNode, { kind: 'command' }> => node.kind === 'command' && node.id === id);
}

function offered(spec: MenuSpec, id: string): Extract<MenuNode, { kind: 'command' }> {
    const row = find(spec, id);
    expect(row, id).toBeDefined();
    return row!;
}

const EVERY_CONTEXT: MenuContext[] = [
    START_SCREEN,
    ...(['canvas', 'drawing', 'diagram', 'chat', 'terminal', 'browser', 'file'] as const).flatMap((view) =>
        [true, false].flatMap((apple) =>
            (['desktop', 'station'] as const).map((host) =>
                context({
                    view,
                    apple,
                    host,
                    offers: {
                        ...NO_OFFERS,
                        duplicate: true,
                        fork: true,
                        openInChat: true,
                        openInTerminal: true,
                        putOnCanvas: true,
                        reveal: true,
                        share: true,
                        makeProject: true,
                        moveToProject: true
                    },
                    moveProjects: [{ id: 'p1', name: 'Vinyl' }],
                    moveTargets: [{ id: 'v2', name: 'Other' }],
                    cells: 2,
                    launches: [{ id: 'dev', name: 'Dev', live: true }],
                    chosenLaunch: 'dev',
                    afterSettle: { tasks: [{ id: 'dev', name: 'Dev' }], chosen: 'dev' }
                })
            )
        )
    )
];

describe('the agents of the menus', () => {
    const agents = [
        { kind: 'claude', name: 'Claude Code', chat: true, terminal: false },
        { kind: 'codex', name: 'Codex', chat: true, terminal: false },
        { kind: 'grok', name: 'Grok', chat: true, terminal: false },
        { kind: 'nanogpt', name: 'NanoGPT', chat: true, terminal: false }
    ];
    const rowsOf = (nodes: readonly MenuNode[]): string[] => nodes.map((node) => (node.kind === 'command' ? node.id : node.kind));

    test('a line sets each group of agents apart from the next', () => {
        const spec = menuModel(context({ agents }));
        const newAgent = flatten(spec.menus.flatMap((entry) => entry.items)).find((node) => node.kind === 'submenu' && node.id === 'new-agent');
        expect(newAgent?.kind === 'submenu' ? rowsOf(newAgent.items) : []).toEqual([
            'agent-chat-claude',
            'agent-chat-codex',
            'separator',
            'agent-chat-grok',
            'separator',
            'agent-chat-nanogpt'
        ]);
        const rows = rowsOf(flatten(spec.menus.flatMap((entry) => entry.items))).filter((id) => id.startsWith('agent-view-') || id === 'separator');
        expect(rows.join(' ')).toContain('agent-view-chat-codex separator agent-view-chat-grok separator agent-view-chat-nanogpt');
    });
});

describe('the menus', () => {
    test('Go disables navigation that has no destination', () => {
        const spec = menuModel(context({ views: ['Main'] }));

        for (const id of [
            'view-previous',
            'view-next',
            'camera-back',
            'camera-forward',
            'node-left',
            'node-right',
            'node-up',
            'node-down',
            'prompts',
            'needs-you-next',
            'go-to-definition',
            'next-change'
        ]) {
            expect(offered(spec, id).enabled).toBe(false);
        }
    });

    test('Go follows each direction and keeps canvas-only navigation out of other views', () => {
        const navigation = {
            views: true,
            camera: { back: true, forward: false },
            focus: { left: false, right: true, up: false, down: true },
            nodes: { left: true, right: false, up: false, down: true },
            prompts: true,
            waiting: true,
            editor: true,
            language: true
        };
        const spec = menuModel(context({ navigation }));

        for (const id of [
            'view-next',
            'camera-back',
            'focus-right',
            'focus-down',
            'node-left',
            'node-down',
            'prompts',
            'needs-you-next',
            'go-to-definition',
            'next-change'
        ]) {
            expect(offered(spec, id).enabled).toBe(true);
        }

        for (const id of ['camera-forward', 'focus-left', 'focus-up', 'node-right', 'node-up']) {
            expect(offered(spec, id).enabled).toBe(false);
        }

        const chat = menuModel(context({ view: 'chat', navigation }));

        for (const id of ['camera-back', 'camera-forward', 'node-left', 'node-right', 'node-up', 'node-down', 'prompts']) {
            expect(find(chat, id)).toBeUndefined();
        }

        expect(offered(chat, 'needs-you-next').enabled).toBe(true);
    });

    test('macOS opens on the application menu, and the view with the focus names the fifth', () => {
        expect(labels(menuModel(context()))).toEqual(['Ruimte', 'File', 'Edit', 'Code', 'View', 'Canvas', 'Go', 'Run', 'Window', 'Help']);
        expect(labels(menuModel(context({ view: 'drawing' })))).toEqual(['Ruimte', 'File', 'Edit', 'Code', 'View', 'Drawing', 'Go', 'Run', 'Window', 'Help']);
        expect(labels(menuModel(context({ view: 'chat' })))).toEqual(['Ruimte', 'File', 'Edit', 'Code', 'View', 'Chat', 'Go', 'Run', 'Window', 'Help']);
    });

    test('the window and help menus carry their role, so macOS lists the open windows there', () => {
        const roles = menuModel(context()).menus.flatMap((entry) => (entry.role ? [[entry.id, entry.role]] : []));
        expect(roles).toEqual([
            ['window', 'window'],
            ['help', 'help']
        ]);
    });

    test('off macOS Settings sits in File and About in Help', () => {
        const spec = menuModel(context({ apple: false }));
        expect(labels(spec)).toEqual(['File', 'Edit', 'Code', 'View', 'Canvas', 'Go', 'Run', 'Window', 'Help']);
        expect(flatten(menu(spec, 'File')).some((node) => node.kind === 'command' && node.id === 'settings')).toBe(true);
        expect(flatten(menu(spec, 'File')).some((node) => node.kind === 'role' && node.role === 'quit')).toBe(true);
        expect(flatten(menu(spec, 'Help')).some((node) => node.kind === 'command' && node.id === 'about')).toBe(true);
    });

    test('a new window opens from anywhere, and only a project moves to one', () => {
        expect(offered(menuModel(START_SCREEN), 'window-new').accelerator).toBe('CommandOrControl+Shift+N');
        expect(find(menuModel(START_SCREEN), 'window-move')).toBeUndefined();
        expect(find(menuModel(context()), 'window-move')).toBeDefined();
        expect(commandIds(menuModel(context({ windows: false })))).not.toContain('window-new');
        expect(commandIds(menuModel(context({ windows: false })))).not.toContain('window-move');
    });

    test('a new chat starts from the start screen and a project alike, unless the machine refused one', () => {
        expect(offered(menuModel(START_SCREEN), 'chat-new').accelerator).toBe('CommandOrControl+Alt+N');
        expect(find(menuModel(context()), 'chat-new')).toBeDefined();
        expect(commandIds(menuModel(context({ newChat: false })))).not.toContain('chat-new');
    });

    test('stopping a pull request watch is offered only for a chat that has one', () => {
        expect(commandIds(menuModel(context()))).not.toContain('pr-watch-stop');
        expect(commandIds(menuModel(context({ prWatch: true })))).toContain('pr-watch-stop');
    });

    test('send and start new chat and restart agent session are offered while a chat has the focus, with the composer key shown', () => {
        expect(commandIds(menuModel(context({ view: 'chat' })))).not.toContain('chat-restart');
        for (const view of ['chat', 'canvas'] as const) {
            const spec = menuModel(context({ view, chat: true }));
            expect(offered(spec, 'chat-send-new').accelerator).toBe('CommandOrControl+Alt+Enter');
            expect(commandIds(spec)).toContain('chat-restart');
        }
    });

    test('the reasoning effort of the chat that has the focus steps up and down from the menu, each with a key of its own', () => {
        expect(commandIds(menuModel(context({ view: 'chat' })))).not.toContain('chat-effort-up');
        for (const view of ['chat', 'canvas'] as const) {
            const spec = menuModel(context({ view, chat: true }));
            expect(offered(spec, 'chat-effort-up').accelerator).toBe('CommandOrControl+Shift+.');
            expect(offered(spec, 'chat-effort-down').accelerator).toBe('CommandOrControl+Shift+,');
        }
    });

    test('a chat in a worktree and a chat from an issue are offered in any view of a project with a folder', () => {
        for (const view of ['canvas', 'chat', 'terminal'] as const) {
            const ids = commandIds(menuModel(context({ view })));
            expect(ids).toContain('chat-new-worktree');
            expect(ids).toContain('issue-start');
        }
        expect(commandIds(menuModel(context({ folder: false })))).not.toContain('chat-new-worktree');
    });

    describe('a chat in Chats that someone wrote in', () => {
        const written = { ...NO_OFFERS, makeProject: true, moveToProject: true };
        const chatMenu = (patch: Partial<MenuContext> = {}): MenuNode[] =>
            menu(
                menuModel(context({ view: 'chat', scratch: true, folder: false, offers: written, moveProjects: [{ id: 'p1', name: 'Vinyl' }], ...patch })),
                'Chat'
            );

        test('can become a project or move into one of the recent projects, or another', () => {
            const items = chatMenu();
            expect(items.flatMap((node) => (node.kind === 'command' ? [node.id] : []))).toContain('chat-make-project');
            const submenu = items.find((node) => node.kind === 'submenu' && node.id === 'chat-move');
            expect(submenu).toMatchObject({ kind: 'submenu', label: 'Move to Project' });
            const rows = submenu?.kind === 'submenu' ? submenu.items : [];
            expect(rows.map((node) => (node.kind === 'command' ? `${node.id}:${node.label}` : node.kind))).toEqual([
                `${CHAT_MOVE_PREFIX}p1:Vinyl`,
                'separator',
                'chat-move-to-project:Other Project…'
            ]);
        });

        test('keeps only "Other Project…" in the submenu without a recent project', () => {
            const submenu = chatMenu({ moveProjects: [] }).find((node) => node.kind === 'submenu' && node.id === 'chat-move');
            expect(submenu).toMatchObject({
                kind: 'submenu',
                items: [{ kind: 'command', id: 'chat-move-to-project', label: 'Other Project…' }]
            });
            expect(submenu?.kind === 'submenu' ? submenu.items : []).toHaveLength(1);
        });

        test('greys both rows while the chat works', () => {
            const items = chatMenu({ chatWorking: true });
            expect(items.find((node) => node.kind === 'command' && node.id === 'chat-make-project')).toMatchObject({ enabled: false });
            expect(items.find((node) => node.kind === 'submenu' && node.id === 'chat-move')).toMatchObject({ enabled: false });
        });

        test('is offered nothing where the offers say no', () => {
            const ids = commandIds(menuModel(context({ view: 'chat', offers: NO_OFFERS })));
            expect(ids).not.toContain('chat-make-project');
            expect(chatMenu({ offers: NO_OFFERS }).some((node) => node.kind === 'submenu' && node.id === 'chat-move')).toBe(false);
        });

        test('has its rows in the palette', () => {
            expect(isPaletteId('chat-make-project')).toBe(true);
            expect(isPaletteId('chat-move-to-project')).toBe(true);
            expect(isPaletteId(`${CHAT_MOVE_PREFIX}p1`)).toBe(false);
        });
    });

    test('showing a pull request has one row per repository once the folder holds several', () => {
        expect(commandIds(menuModel(context()))).toContain('pr-show');
        const repos = [
            { path: '/work/backend', label: 'backend' },
            { path: '/work/web', label: 'web' }
        ];
        const ids = commandIds(menuModel(context({ prRepos: repos })));
        expect(ids).not.toContain('pr-show');
        expect(ids).toContain('pr-show-in-/work/backend');
        expect(ids).toContain('pr-show-in-/work/web');
    });

    test('the Chats project has no panels for a folder, no launches and no folder to reveal', () => {
        const spec = menuModel(context({ scratch: true, folder: false }));
        expect(labels(spec)).not.toContain('Run');
        const ids = commandIds(spec);
        for (const id of ['panel-files', 'panel-git', 'panel-devices', 'launch-run', 'reveal', 'find-in-files', 'view-new-file']) {
            expect(ids).not.toContain(id);
        }
        expect(ids).toContain('panel-processes');
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

    test('while the settings are open, Find searches them, on the start screen as well', () => {
        for (const base of [context(), START_SCREEN]) {
            const spec = menuModel({ ...base, settingsOpen: true });
            expect(offered(spec, 'settings-search').accelerator).toBe('CommandOrControl+F');
            expect(find(spec, 'find')).toBeUndefined();
        }
        expect(find(menuModel(context()), 'settings-search')).toBeUndefined();
    });

    test('the station has no shell, no clipboard roles and no release notes', () => {
        const spec = menuModel(context({ host: 'station', apple: true, releaseNotes: false }));
        expect(labels(spec)).toEqual(['File', 'Edit', 'Code', 'View', 'Canvas', 'Go', 'Run', 'Window', 'Help']);
        const nodes = spec.menus.flatMap((entry) => flatten(entry.items));
        expect(nodes.some((node) => node.kind === 'role' || node.kind === 'shell')).toBe(false);
        expect(commandIds(spec)).toContain('about');
        expect(commandIds(spec)).toContain('close-cell');
        expect(commandIds(spec)).not.toContain('release-notes');
    });

    test('setting up Ruimte opens from Help in the desktop app, on the start screen too, and never on the station', () => {
        for (const spec of [menuModel(context()), menuModel(START_SCREEN)]) {
            expect(menu(spec, 'Help').some((node) => node.kind === 'command' && node.id === 'onboarding')).toBe(true);
        }
        expect(commandIds(menuModel(context({ host: 'station' })))).not.toContain('onboarding');
    });

    test('setting up Ruimte is not offered when this app runs no machine', () => {
        expect(commandIds(menuModel(context({ localMachine: false })))).not.toContain('onboarding');
        expect(commandIds(menuModel(context()))).toContain('onboarding');
    });

    test('the station prints its keys, except the ones a browser tab keeps, and undoes its own history', () => {
        const spec = menuModel(context({ host: 'station', apple: true, cells: 2 }));
        expect(find(spec, 'palette')).toMatchObject({ keys: '⌘K' });
        expect(offered(spec, 'palette').accelerator).toBeUndefined();
        expect(offered(spec, 'close-cell').keys).toBeUndefined();
        expect(offered(spec, 'view-new').keys).toBeUndefined();
        expect(find(spec, 'edit-undo')).toMatchObject({ keys: '⌘Z', enabled: true });
        expect(offered(spec, 'fullscreen').checked).toBe(false);
        expect(offered(menuModel(context({ host: 'station', view: 'terminal' })), 'edit-undo').enabled).toBe(false);
    });

    test('Open File at Line in Go only acts while a diff is in front', () => {
        expect(offered(menuModel(context({ diff: false })), 'open-file-at-line').enabled).toBe(false);
        expect(offered(menuModel(context({ diff: true })), 'open-file-at-line').enabled).not.toBe(false);
    });

    test('a terminal can be cleared and the project has its settings in File', () => {
        const spec = menuModel(context({ view: 'terminal' }));
        expect(menu(spec, 'Terminal').some((node) => node.kind === 'command' && node.id === 'terminal-clear')).toBe(true);
        expect(menu(spec, 'File').some((node) => node.kind === 'command' && node.id === 'project-settings')).toBe(true);
        expect(commandIds(menuModel(START_SCREEN))).not.toContain('project-settings');
    });

    test('the clear key shows on Clear while a terminal has the keyboard, and on the palette otherwise', () => {
        const typing = menuModel(context({ view: 'terminal', terminalKeys: true }));
        expect(offered(typing, 'terminal-clear').accelerator).toBe('Command+K');
        expect(offered(typing, 'palette').accelerator).toBeUndefined();
        const elsewhere = menuModel(context({ view: 'terminal', terminalKeys: false }));
        expect(offered(elsewhere, 'terminal-clear').accelerator).toBeUndefined();
        expect(offered(elsewhere, 'palette').accelerator).toBe('CommandOrControl+K');
    });

    test('the find row shows the terminal key while a terminal with a find bar has the keyboard, and the window key otherwise', () => {
        const typing = menuModel(context({ view: 'terminal', apple: false, terminalKeys: true, terminalFind: true }));
        expect(offered(typing, 'find').accelerator).toBe('Control+Shift+F');
        const elsewhere = menuModel(context({ view: 'terminal', apple: false, terminalKeys: false }));
        expect(offered(elsewhere, 'find').accelerator).toBe('CommandOrControl+F');
        const mac = menuModel(context({ view: 'terminal', apple: true, terminalKeys: true, terminalFind: true }));
        expect(offered(mac, 'find').accelerator).toBe('Command+F');
    });

    test('the find row shows no key in a terminal without a find bar', () => {
        const spec = menuModel(context({ view: 'terminal', apple: false, terminalKeys: true, terminalFind: false }));
        expect(offered(spec, 'find').accelerator).toBeUndefined();
    });

    test('find in files gives Ctrl+Shift+F to a terminal off macOS, and keeps its key everywhere else', () => {
        expect(offered(menuModel(context({ apple: false, terminalKeys: true })), 'find-in-files').accelerator).toBeUndefined();
        expect(offered(menuModel(context({ apple: false, terminalKeys: false })), 'find-in-files').accelerator).toBe('CommandOrControl+Shift+F');
        expect(offered(menuModel(context({ apple: true, terminalKeys: true })), 'find-in-files').accelerator).toBe('CommandOrControl+Shift+F');
    });

    test('Cmd+W closes the last cell before it closes the window', () => {
        const one = menuModel(context({ cells: 1 }));
        expect(menu(one, 'File').some((node) => node.kind === 'role' && node.role === 'close')).toBe(false);
        expect(offered(one, 'close-cell').accelerator).toBe('CommandOrControl+W');
        const two = menuModel(context({ cells: 2 }));
        expect(offered(two, 'close-cell').accelerator).toBe('CommandOrControl+W');
        const empty = menu(menuModel(context({ cells: 0, view: null })), 'File');
        expect(empty.some((node) => node.kind === 'role' && node.role === 'close')).toBe(true);
    });

    test('a single-tab host offers closing its tab and its cell', () => {
        const spec = menuModel(context({ cells: 1, tabs: { hosted: true, count: 1, index: 0, splitOff: false } }));
        expect(offered(spec, 'tab-close').accelerator).toBe('CommandOrControl+W');
        expect(offered(spec, 'close-cell').enabled).not.toBe(false);
        expect(offered(spec, 'close-cell').accelerator).toBeUndefined();
    });

    test('what waits on a selection or a split is greyed rather than gone', () => {
        const spec = menuModel(context({ selection: 0, split: { right: false, down: true }, cells: 1 }));
        expect(offered(spec, 'group-selection').enabled).toBe(false);
        expect(offered(spec, 'view-promote').enabled).toBe(false);
        expect(offered(spec, 'split-right').enabled).toBe(false);
        expect(offered(spec, 'split-down').enabled).toBe(true);
        expect(offered(spec, 'focus-left').enabled).toBe(false);
        expect(offered(menuModel(context({ selection: 2 })), 'group-selection').enabled).toBe(true);
        expect(offered(spec, 'group-arrange').enabled).toBe(false);
        expect(offered(menuModel(context({ selection: 1, groupArrangeable: true })), 'group-arrange').enabled).toBe(true);
    });

    test('a cell maximizes from View while the grid has more than one, and says so while it does', () => {
        expect(offered(menuModel(context({ cells: 1 })), 'cell-maximize').enabled).toBe(false);
        const two = find(menuModel(context({ cells: 2, maximized: true })), 'cell-maximize');
        expect(two).toMatchObject({ enabled: true, checked: true, accelerator: 'CommandOrControl+Shift+Enter' });
    });

    test('the maximize key moves to the node item while a node on the canvas is what it acts on', () => {
        const idle = menuModel(context({ cells: 2 }));
        expect(find(idle, 'node-maximize')).toMatchObject({ enabled: false });
        expect(offered(idle, 'node-maximize').accelerator).toBeUndefined();
        const node = menuModel(context({ cells: 2, nodeMaximizable: true, nodeMaximized: true }));
        expect(find(node, 'node-maximize')).toMatchObject({ enabled: true, checked: true, accelerator: 'CommandOrControl+Shift+Enter' });
        expect(offered(node, 'cell-maximize').accelerator).toBeUndefined();
    });

    test('closing the other cells or those to the right sits under Close, greyed while there is nothing to close', () => {
        const one = menuModel(context({ cells: 1 }));
        expect(offered(one, 'cell-close-others').enabled).toBe(false);
        expect(offered(one, 'cell-close-right').enabled).toBe(false);
        const three = menuModel(context({ cells: 3, closesRight: true }));
        expect(offered(three, 'cell-close-others').enabled).toBe(true);
        expect(offered(three, 'cell-close-right').enabled).toBe(true);
        expect(commandIds(menuModel(START_SCREEN))).not.toContain('cell-close-others');
    });

    test('keeping the Mac awake is a choice of three under Settings, with the one in force marked', () => {
        const spec = menuModel(context({ keepAwake: 'working' }));
        const app = menu(spec, 'Ruimte');
        const keepAwake = app[app.findIndex((node) => node.kind === 'command' && node.id === 'settings') + 1];
        expect(keepAwake).toMatchObject({ kind: 'submenu', id: 'keep-awake', label: 'Keep Computer Awake' });
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

    test('the folding commands sit together in a submenu of Code, the levels and the documentation comments among them', () => {
        const folding = menu(menuModel(context()), 'Code').find((node) => node.kind === 'submenu' && node.id === 'folding');
        expect(folding?.kind === 'submenu' ? folding.items.map((node) => (node.kind === 'command' ? node.id : node.kind)) : []).toEqual([
            'collapse-region',
            'expand-region',
            'collapse-region-recursively',
            'expand-region-recursively',
            'collapse-all-regions',
            'expand-all-regions',
            'fold-selection',
            'collapse-doc-comments',
            'expand-doc-comments',
            'expand-all-to-level-1',
            'expand-all-to-level-2',
            'expand-all-to-level-3',
            'expand-all-to-level-4',
            'expand-all-to-level-5'
        ]);
    });

    test('zoom is offered on every view and only works where there is a camera', () => {
        expect(offered(menuModel(context({ view: 'drawing' })), 'fit').enabled).toBe(true);
        expect(offered(menuModel(context({ view: 'terminal' })), 'fit').enabled).toBe(false);
    });

    test('the panels and the sidebar are check marks, Processes sits in Window', () => {
        const spec = menuModel(context({ panel: 'processes', sidebar: false }));
        expect(offered(spec, 'sidebar').checked).toBe(false);
        expect(offered(spec, 'panel-files').checked).toBe(false);
        expect(menu(spec, 'Window').some((node) => node.kind === 'command' && node.id === 'panel-processes' && node.checked === true)).toBe(true);
    });

    test('Compare Models sits in Window right under Usage, on the start screen and in a workspace, and in the palette', () => {
        for (const spec of EVERY_CONTEXT.map(menuModel)) {
            const ids = menu(spec, 'Window').flatMap((node) => (node.kind === 'command' ? [node.id] : []));
            expect(ids[ids.indexOf('usage') + 1]).toBe('models');
            expect(offered(spec, 'models').accelerator).toBeUndefined();
            expect(offered(spec, 'models').keys).toBeUndefined();
        }
        expect(isPaletteId('models')).toBe(true);
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

    test('Run acts on the launch on the chip with its shortcuts, and lists every launch to choose from', () => {
        const spec = menuModel(
            context({
                launches: [
                    { id: 'server', name: 'Run server', live: true },
                    { id: 'dev', name: 'Dev', live: false }
                ],
                chosenLaunch: 'dev'
            })
        );
        expect(find(spec, 'launch-run')).toMatchObject({ label: 'Launch Dev', accelerator: 'CommandOrControl+Alt+R' });
        expect(find(spec, 'launch-stop')).toMatchObject({ label: 'Stop Dev', accelerator: 'CommandOrControl+Alt+.', enabled: false });
        expect(offered(spec, 'launches-stop-all').enabled).toBe(true);
        expect(find(spec, `${LAUNCH_CHOOSE_PREFIX}dev`)).toMatchObject({ checked: true, radio: true });
        expect(offered(spec, `${LAUNCH_CHOOSE_PREFIX}server`).checked).toBe(false);
        expect(offered(menuModel(context({ launches: [{ id: 'dev', name: 'Dev', live: true }], chosenLaunch: 'dev' })), 'launch-run').label).toBe(
            'Restart Dev'
        );
    });

    test('Run offers the tasks that may run after a worktree chat settles, with the one that does checked', () => {
        const spec = menuModel(context({ afterSettle: { tasks: [{ id: 'tests', name: 'Run tests' }], chosen: 'tests' } }));
        expect(find(spec, `${AFTER_SETTLE_PREFIX}tests`)).toMatchObject({ label: 'Run tests', checked: true, radio: true });
        expect(find(spec, 'launches-after-settle-off')).toMatchObject({ label: 'Run Nothing', checked: false });
    });

    test('without launches Run still offers to add one', () => {
        const ids = menu(menuModel(context()), 'Run').flatMap((node) => (node.kind === 'command' ? [node.id] : []));
        expect(ids).toEqual(['launch-run', 'launch-stop', 'launches-stop-all', 'launches-output', 'launches-edit']);
        expect(offered(menuModel(context()), 'launch-run').enabled).toBe(false);
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
    // A row of the table runs through the palette or through `MENU_ACTIONS`, which the type holds to every row the palette lacks.
    test('every id in any menu fits the known command route grammar', () => {
        const ids = new Set(EVERY_CONTEXT.flatMap((entry) => commandIds(menuModel(entry))));
        for (const id of ids) {
            const handled =
                isCommandId(id) ||
                isPaletteId(id) ||
                id.startsWith(GO_VIEW_PREFIX) ||
                id.startsWith(LAUNCH_CHOOSE_PREFIX) ||
                id.startsWith(AFTER_SETTLE_PREFIX) ||
                id.startsWith(CHAT_MOVE_PREFIX);
            expect(handled ? id : `${id} has no handler`).toBe(id);
        }
    });

    test('every row of the table the palette has is a row of the palette', () => {
        const source = readFileSync(join(import.meta.dir, '..', 'commands.ts'), 'utf8');
        const pullRequestRows = readFileSync(join(import.meta.dir, '..', 'pull-request-commands.ts'), 'utf8');
        for (const id of COMMAND_IDS.filter((candidate) => COMMANDS[candidate].palette)) {
            // The language commands are rows of `languageCommandRows()`, which `appCommands()` spreads in.
            const listed =
                (LANGUAGE_COMMAND_IDS as readonly string[]).includes(id) ||
                (EDITOR_COMMAND_IDS as readonly string[]).includes(id) ||
                source.includes(`id: '${id}'`) ||
                new RegExp(`row\\(\\s*'${id}'`).test(source) ||
                pullRequestRows.includes(`id: '${id}'`);
            expect(listed ? id : `${id} is not in appCommands()`).toBe(id);
        }
        expect(source).toContain('languageCommandRows()');
        expect(languageCommandRows().map((row) => row.id)).toEqual([...LANGUAGE_COMMAND_IDS]);
        expect(source).toContain('editorCommandRows()');
        expect(editorCommandRows().map((row) => row.id)).toEqual([...EDITOR_COMMAND_IDS]);
        for (const row of [
            '`agent-${target}-${provider.kind}`',
            '`agent-view-${target}-${provider.kind}`',
            '`layout-apply-${layout.name}`',
            '`layout-delete-${layout.name}`',
            '`view-move-${view.id}`'
        ]) {
            expect(source).toContain(row);
        }
        expect(pullRequestRows).toContain('`${PR_SHOW_IN_PREFIX}${repo.path}`');
        expect(isPaletteId('pr-show-in-/work/web')).toBe(true);
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

    test('every row of the command table with a chord yields a whole accelerator, ending in a key Electron knows', () => {
        const electronKey = /^(?:.|Backspace|Delete|Enter|Tab|Escape|Space|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|F\d{1,2}|Plus)$/;
        const checked: string[] = [];

        for (const id of COMMAND_IDS) {
            const chord = COMMANDS[id].shortcut;

            if (chord === undefined || menuPlacesOf(id).length === 0) {
                continue;
            }

            for (const apple of [true, false]) {
                const accelerator = toAccelerator(chord, apple);
                const bound = chord.mod || chord.ctrl || chord.meta;

                if (apple && !bound) {
                    expect(accelerator, `${id} on macOS`).toBeUndefined();

                    continue;
                }

                expect(accelerator, `${id} (apple ${apple})`).toBeDefined();
                expect(accelerator!.split('+').at(-1) ?? '', `${id} (apple ${apple}) names its key`).toMatch(electronKey);
                checked.push(id);
            }
        }

        expect(checked).toContain('last-edit-location');
        expect(checked).toContain('move-statement-up');
        expect(checked).toContain('complete-current-statement');
        expect(checked).toContain('method-up');
    });
});
