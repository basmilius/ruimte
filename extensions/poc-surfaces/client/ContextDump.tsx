import { useActiveView, useCanvasNodes, useProject, useSelection } from '@ruimte/extension/client';

export default function ContextDump() {
    const project = useProject();
    const view = useActiveView();
    const selection = useSelection();
    const nodes = useCanvasNodes();

    return <pre style={{ padding: 8, whiteSpace: 'pre-wrap' }}>{JSON.stringify({ project, view, selection, nodes: nodes.length }, null, 2)}</pre>;
}
