import { artifacts, browser, defineAction, definePaletteSource, definePanel, devices, host, launches, routines, terminals } from '@ruimte/extension/client';

const show = (value: unknown): void => host.notify(JSON.stringify(value).slice(0, 200));

definePaletteSource({
    id: 'numbers',
    title: 'POC machine',
    search: async (query) =>
        /^\d+$/.test(query)
            ? [{ id: query, title: `Double ${query}`, detail: String(Number(query) * 2), run: () => host.notify(String(Number(query) * 2)) }]
            : []
});

definePanel({ id: 'machine', title: 'POC machine', icon: 'server-cog', component: () => import('./MachinePanel') });

defineAction({
    id: 'read-terminal',
    title: 'Read this terminal',
    icon: 'scroll-text',
    slots: { terminalMenu: true },
    run: async ({ node }) => show(await terminals.read(node))
});
defineAction({
    id: 'inspect-browser',
    title: 'Inspect this browser',
    icon: 'globe',
    slots: { nodeHeader: ({ node }) => node.kind === 'browser' },
    run: async ({ node }) => show(await browser.inspect({ nodeId: node.id }))
});
defineAction({
    id: 'open-terminal',
    title: 'Open a terminal beside',
    icon: 'square-terminal',
    slots: { nodeMenu: true },
    run: ({ node }) => void terminals.open({ title: 'From POC', near: [node] })
});

export const LISTS = { launches, routines, artifacts, devices };
