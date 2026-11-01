import { agents, canvas, context, defineCanvasAction, defineSidebarCard, host } from '@ruimte/extension/client';

defineSidebarCard({ id: 'agents', title: 'POC agents', component: () => import('./AgentsCard') });
defineCanvasAction({
    id: 'summarize',
    title: 'POC: summarize the selection',
    when: ({ selection }) => selection.length > 0,
    run: async ({ selection }) => {
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
