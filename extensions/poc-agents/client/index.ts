import { agents, canvas, context, defineAction, defineSidebarCard, host, type NodeInfo } from '@ruimte/extension/client';

defineSidebarCard({ id: 'agents', title: 'POC agents', component: () => import('./AgentsCard') });

async function summarize(nodes: NodeInfo[]): Promise<void> {
    const sources = await context.read({ nodes });
    const { text } = await agents.run({
        prompt: 'Summarize what follows in three lines.',
        context: sources.map((source) => `# ${source.title}\n${source.text}`)
    });
    const note = canvas.createNote({ title: 'Summary', text, near: nodes });

    if (note === null) {
        host.notify('No canvas to write on', { tone: 'error' });

        return;
    }

    for (const source of nodes) {
        canvas.link(source, note);
    }

    canvas.reveal(note);
}

// Only on a chat that is done, or on a selection of several.
const isDoneChat = (node: NodeInfo) => node.kind === 'chat' && node.agent?.status === 'idle';

defineAction({
    id: 'summarize',
    title: 'Summarize',
    icon: 'sparkles',
    slots: {
        selectionBar: ({ nodes }) => nodes.length > 1,
        nodeHeader: ({ node }) => isDoneChat(node),
        nodeMenu: ({ node, nodes }) => (nodes.length > 1 ? { title: `Summarize ${nodes.length} nodes` } : isDoneChat(node) && { title: 'Summarize this chat' }),
        commandPalette: ({ nodes }) => nodes.length > 0
    },
    run: (target) => summarize('nodes' in target ? target.nodes : [target.node])
});
