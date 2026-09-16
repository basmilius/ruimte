import { useMemo } from 'react';
import { deriveContextSources, type ContextSource } from '@ruimte/contracts';
import { useCanvas } from '@/state/canvas';

const NONE: ContextSource[] = [];

/* Whether this node has readable context linked into it, as one boolean for a header; the daemon applies the same rule to the saved document. */
export const useHasContextLinks = (id: string): boolean => useCanvas((s) => (deriveContextSources(s.nodes, s.texts, s.edges).get(id)?.length ?? 0) > 0);

/* What the lines into this node make readable, in the order of the lines. */
export const useContextSources = (id: string): ContextSource[] => {
    const nodes = useCanvas((s) => s.nodes);
    const texts = useCanvas((s) => s.texts);
    const edges = useCanvas((s) => s.edges);
    return useMemo(() => deriveContextSources(nodes, texts, edges).get(id) ?? NONE, [nodes, texts, edges, id]);
};
