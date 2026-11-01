import {
    defineAction,
    defineCanvasOverlay,
    defineCommand,
    defineExtensionSettings,
    defineNode,
    defineMenu,
    defineNodeHeader,
    definePanel,
    defineSidebarCard,
    defineView,
    host
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
defineAction({
    id: 'count',
    title: 'Count',
    icon: 'hash',
    show: ['selectionBar', 'commands'],
    when: ({ nodes }) => nodes.length > 0,
    run: ({ nodes }) => host.notify(`${nodes.length} selected`)
});
defineAction({ id: 'show-id', title: 'Show the id', run: ({ nodes }) => host.notify(nodes.map((node) => node.id).join(', ')) });
defineAction({
    id: 'wait',
    title: 'Wait three seconds',
    icon: 'hourglass',
    show: ['nodeHeader'],
    run: () => new Promise((done) => setTimeout(done, 3000))
});
defineMenu({ id: 'menu', title: 'POC surfaces', icon: 'flask-conical', show: ['nodeMenu'], items: ['count', 'show-id', 'wait'] });
defineNodeHeader({ id: 'kind', when: ({ kind }) => kind === 'note', component: () => import('./HeaderTag') });
console.info('poc-surfaces loaded');
