import {
    defineAction,
    defineCanvasOverlay,
    defineCommand,
    defineExtensionSettings,
    defineNode,
    defineFileViewer,
    defineMarkdownBlock,
    defineMenu,
    defineWidget,
    definePanel,
    defineSidebarCard,
    defineToolResult,
    defineView,
    host,
    type NodeInfo,
    type Slots
} from '@ruimte/extension/client';

const panel = // No icon, so it shows assets/icon.svg.
    definePanel({ id: 'panel', title: 'POC panel', component: () => import('./ContextDump') });
const view = defineView({ id: 'view', title: 'POC view', icon: 'flask-conical', component: () => import('./ViewBody') });

defineSidebarCard({ id: 'card', title: 'POC card', component: () => import('./Counter') });
defineCanvasOverlay({ id: 'overlay', component: () => import('./Overlay') });
defineExtensionSettings({ component: () => import('./Counter'), keywords: ['poc'] });

defineNode({
    id: 'counter',
    title: 'POC counter',
    icon: 'flask-conical',
    size: { width: 280, height: 160 },
    initialData: { count: 0 },
    dataVersion: 2,
    // A node stored by version 1 held a bare number.
    migrate: (stored) => ({ count: typeof stored === 'number' ? stored : 0 }),
    component: () => import('./CounterNode')
});

defineCommand({ id: 'open-panel', title: 'POC: open the panel', run: () => panel.open() });
defineCommand({ id: 'open-view', title: 'POC: open a view', run: () => view.open({ from: 'command' }) });
defineCommand({ id: 'notify', title: 'POC: notify', run: () => host.notify('Hello from POC surfaces') });
defineCommand({
    id: 'confirm',
    title: 'POC: ask to confirm',
    run: async () => host.notify((await host.confirm({ title: 'POC', body: 'Say yes or no' })) ? 'Yes' : 'No')
});
const count = defineAction({
    id: 'count',
    title: 'Count',
    icon: 'hash',
    slots: {
        selectionBar: ({ nodes }) => nodes.length > 0,
        commandPalette: ({ nodes }) => nodes.length > 0
    },
    run: ({ nodes }) => host.notify(`${nodes.length} selected`)
});
// No slots: this only shows through the menu below.
const showId = defineAction<{ node: NodeInfo }>({ id: 'show-id', title: 'Show the id', run: ({ node }) => host.notify(node.id) });
const wait = defineAction({
    id: 'wait',
    title: 'Wait three seconds',
    icon: 'hourglass',
    slots: { nodeHeader: ({ node }) => node.kind === 'note' },
    run: () => new Promise((done) => setTimeout(done, 3000))
});

defineMenu({
    id: 'menu',
    title: 'POC surfaces',
    icon: 'flask-conical',
    slots: { nodeMenu: true, canvasMenu: true },
    items: (context) => [
        count,
        ...('node' in context ? [showId] : []),
        'separator',
        wait,
        { title: 'A plain item', run: () => host.notify('Plain') },
        { title: 'A submenu', items: [wait] }
    ]
});

const OTHER_SLOTS = [
    'viewToolbar',
    'viewMenu',
    'panelHeader',
    'composer',
    'messageActions',
    'lineMenu',
    'fileMenu',
    'editorToolbar',
    'editorMenu',
    'diffToolbar',
    'terminalToolbar',
    'browserToolbar'
] as const;

// One for each slot this one has no other use for, so each spot can be checked by eye.
for (const word of OTHER_SLOTS) {
    defineAction({
        id: `in-${word}`,
        title: `POC in ${word}`,
        icon: 'flask-conical',
        slots: { [word]: true } as Slots<typeof word>,
        run: () => host.notify(`From ${word}`)
    });
}

defineWidget({ id: 'tag', slots: { nodeHeader: ({ node }) => node.kind === 'note' }, component: () => import('./HeaderTag') });
defineFileViewer({ id: 'csv', title: 'Table', extensions: ['csv'], component: () => import('./CsvTable') });
defineMarkdownBlock({ language: 'poc', component: () => import('./PocFence') });
defineToolResult({ id: 'read', tools: ['Read'], component: () => import('./ReadResult') });
console.info('poc-surfaces loaded');
