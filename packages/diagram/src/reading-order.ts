import type { DiagramDocument, DiagramNode } from '@ruimte/contracts';
import { layersOf } from './layout.ts';

const nameOf = (node: DiagramNode | undefined, id: string): string => (node && node.label.trim() !== '' ? node.label : id);

/*
 * A diagram as lines an agent can read: every node layer by layer (file order inside a layer), then
 * every edge as the two names it joins, then what each group holds. Unlike a drawing nothing has to
 * be guessed, since the file already says what points at what.
 */
export const readingOrder = (document: Pick<DiagramDocument, 'nodes' | 'groups' | 'edges'>): string[] => {
    const byId = new Map(document.nodes.map((node) => [node.id, node]));
    const layers = layersOf(document.nodes, document.edges);
    const nodes = document.nodes
        .map((node, index) => ({ node, index, layer: layers.get(node.id) ?? 0 }))
        .sort((left, right) => left.layer - right.layer || left.index - right.index)
        .map(({ node }) => (node.sub ? `${nameOf(node, node.id)} (${node.sub})` : nameOf(node, node.id)));
    const edges = document.edges.map((edge) => {
        const line = `${nameOf(byId.get(edge.from), edge.from)} -> ${nameOf(byId.get(edge.to), edge.to)}`;
        return edge.label ? `${line}: ${edge.label}` : line;
    });
    const groups = document.groups.map((group) => `${group.label || group.id} wraps: ${group.wraps.map((id) => nameOf(byId.get(id), id)).join(', ')}`);
    return [...nodes, ...edges, ...groups];
};
