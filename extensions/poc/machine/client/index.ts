import {
    artifacts,
    browser,
    defineAction,
    definePaletteSource,
    definePanel,
    devices,
    host,
    launches,
    routines,
    terminals,
    type Result
} from '@ruimte/extension/client';

function show<Value>(answer: Result<Value>): void {
    if (!answer.ok) {
        host.notify(answer.error.message, { tone: 'error' });

        return;
    }

    host.notify(JSON.stringify(answer.value).slice(0, 200));
}

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
    run: async ({ node }) => show(await browser.inspect({ node }))
});
defineAction({
    id: 'open-terminal',
    title: 'Open a terminal beside',
    icon: 'square-terminal',
    slots: { nodeMenu: true },
    run: ({ node }) => {
        const opened = terminals.open({ title: 'From POC', near: [node] });

        if (!opened.ok) {
            show(opened);
        }
    }
});

export const LISTS = { launches, routines, artifacts, devices };
