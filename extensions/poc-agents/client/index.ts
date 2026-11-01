import { agents, canvas, context, defineAction, defineSidebarCard, host } from '@ruimte/extension/client';

defineSidebarCard({ id: 'agents', title: 'POC agents', component: () => import('./AgentsCard') });
defineAction({
    id: 'summarize',
    title: 'Summarize',
    icon: 'sparkles',
    show: ['selectionBar', 'nodeHeader', 'nodeMenu', 'commands'],
    when: ({ nodes }) => nodes.length > 0,
    run: async ({ nodes: selection }) => {
        const sources = await context.read({ nodes: selection });
        const { text } = await agents.run({
            prompt: 'Summarize what follows in three lines.',
            context: sources.map((source) => `# ${source.title}\n${source.text}`)
        });
        const note = canvas.createNote({ title: 'Summary', text, near: selection });

        if (note === null) {
            host.notify('No canvas to write on', { tone: 'error' });

            return;
        }

        for (const source of selection) {
            canvas.link(source, note);
        }

        canvas.reveal(note);
    }
});
