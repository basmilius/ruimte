import { defineAction, defineSidebarCard, getServer, host, terminals } from '@ruimte/extension/client';
import type { HarborServer } from '../server/index';

const SHELL_PROFILE = 'service-shell';

defineSidebarCard({ id: 'service', title: 'Harbor', component: () => import('./ServiceCard') });

defineAction({
    id: 'shell',
    title: 'Harbor shell here',
    icon: 'container',
    slots: { canvasMenu: true, nodeMenu: ({ node }) => node.kind === 'terminal' && { title: 'Harbor shell beside this' } },
    run: async (context) => {
        const near = 'node' in context ? [{ id: context.node.id }] : undefined;
        const opened = await terminals.open({ profile: SHELL_PROFILE, title: 'Harbor', ...(near === undefined ? {} : { near }) });

        if (!opened.ok) {
            throw new Error(opened.error.message);
        }

        const typed = await terminals.write(opened.value, 'echo "Harbor: $HARBOR_SERVICE"\n');

        if (!typed.ok) {
            throw new Error(typed.error.message);
        }
    }
});

defineAction({
    id: 'last-line',
    title: 'Harbor: show the last line',
    icon: 'scroll-text',
    slots: { terminalMenu: true },
    run: async ({ node }) => {
        const screen = await terminals.read(node);

        if (!screen.ok) {
            throw new Error(screen.error.message);
        }

        host.notify(screen.value.trimEnd().split('\n').at(-1) ?? '');
    }
});

defineAction({
    id: 'shell-view',
    title: 'Harbor: open a shell in a view of its own',
    icon: 'container',
    slots: { commandPalette: true },
    run: async ({ project }) => {
        const opened = await getServer<HarborServer>().openShell(project.id);

        if (!opened.ok) {
            throw new Error(opened.error.message);
        }
    }
});
