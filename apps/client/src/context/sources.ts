import { useMemo } from 'react';
import { deriveContextSources, type ContextSource } from '@ruimte/contracts';
import { useCanvas, type CanvasNode, type Edge, type TextElement } from '@/state/canvas';
import { memoByIdentity } from '@/state/identity-memo';

const NONE: ContextSource[] = [];

/* Every NodeFrame asks this in a selector, so one derivation serves them all. */
export const contextSourcesOf = memoByIdentity((nodes: Record<string, CanvasNode>, texts: Record<string, TextElement>, edges: Edge[]) =>
    deriveContextSources(nodes, texts, edges)
);

/* Whether this node has readable context linked into it, as one boolean for a header; the daemon applies the same rule to the saved document. */
export function useHasContextLinks(id: string): boolean {
    return useCanvas((s) => (contextSourcesOf(s.nodes, s.texts, s.edges).get(id)?.length ?? 0) > 0);
}

/* What the lines into this node make readable, in the order of the lines. */
export function useContextSources(id: string): ContextSource[] {
    const nodes = useCanvas((s) => s.nodes);
    const texts = useCanvas((s) => s.texts);
    const edges = useCanvas((s) => s.edges);
    return useMemo(() => contextSourcesOf(nodes, texts, edges).get(id) ?? NONE, [nodes, texts, edges, id]);
}

/*
 * The chats a line connects to a node, whichever way it was drawn, in canvas order. A node inside a
 * group is linked to what the group is linked to.
 */
export function chatsLinkedTo(nodes: Record<string, CanvasNode>, texts: Record<string, TextElement>, edges: Edge[], nodeId: string): string[] {
    const sources = contextSourcesOf(nodes, texts, edges);
    const readByNode = new Set((sources.get(nodeId) ?? NONE).map((source) => source.id));
    return Object.values(nodes)
        .filter((node) => node.kind === 'chat' && node.id !== nodeId)
        .filter((chat) => readByNode.has(chat.id) || (sources.get(chat.id) ?? NONE).some((source) => source.id === nodeId))
        .map((chat) => chat.id);
}
