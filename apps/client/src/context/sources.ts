import { deriveContextSources } from '@ruimte/contracts';
import { useCanvas } from '@/state/canvas';

/* Whether this node has readable context linked into it, as one boolean for a header; the daemon applies the same rule to the saved document. */
export const useHasContextLinks = (id: string): boolean => useCanvas((s) => (deriveContextSources(s.nodes, s.texts, s.edges).get(id)?.length ?? 0) > 0);
