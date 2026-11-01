import {
    defineCanvasAction,
    defineCanvasOverlay,
    defineCommand,
    defineExtensionSettings,
    defineNode,
    defineNodeMenuItem,
    definePanel,
    defineSidebarCard,
    defineView,
    host
} from '@ruimte/extension/client';

const panel = definePanel({ id: 'panel', title: 'POC panel', icon: 'flask-conical', component: () => import('./ContextDump') });
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
defineCanvasAction({
    id: 'count',
    title: 'POC: count the selection',
    when: ({ selection }) => selection.length > 0,
    run: ({ selection }) => host.notify(`${selection.length} selected`)
});
defineNodeMenuItem({ id: 'id', title: 'POC: show the id', run: ({ node }) => host.notify(node.id) });
