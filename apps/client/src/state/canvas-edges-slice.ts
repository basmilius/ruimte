import { isAgentKind } from '@ruimte/contracts';
import type { CanvasState } from '@/state/canvas';
import { center, mirroredSides, nextId, remember, type CanvasGet, type CanvasSet, type Edge, type EdgeSides } from '@/state/canvas-model';
import { canLink } from '@/state/edge-lines';

export function createCanvasEdgesSlice(
    set: CanvasSet,
    get: CanvasGet
): Pick<CanvasState, 'addEdge' | 'startLink' | 'removeEdge' | 'setEdgeLabel' | 'setLinkDraft'> {
    return {
        addEdge(from, to, sides) {
            const s = get();
            // A node folded to its header takes no new line, from or to it; the ones it has stay.
            const exists = (id: string): boolean => s.nodes[id] !== undefined && s.nodes[id].collapsed !== true;
            if (!exists(from) || !exists(to) || !canLink(s.edges, from, to)) {
                return null;
            }
            const isAgent = (id: string): boolean => {
                const node = s.nodes[id];
                return node !== undefined && isAgentKind(node.kind);
            };
            const drawn: Edge[] = [];
            const draw = (start: string, end: string, ends: EdgeSides): void => {
                if (!canLink([...s.edges, ...drawn], start, end)) {
                    return;
                }
                // Only a line into an agent carries meaning, so only that one gets a label by default.
                const label = isAgent(end) ? 'context' : undefined;
                drawn.push({ id: nextId('edge'), from: start, to: end, label, ...ends });
            };
            draw(from, to, sides ?? {});
            // Both ways between two agents, as the daemon's `link new` draws it: a line lets only its head read its tail.
            if (isAgent(from) && isAgent(to)) {
                draw(to, from, mirroredSides(sides));
            }
            // One handling is one step in the history, whether it drew one line or the pair.
            set({ edges: [...s.edges, ...drawn], linkDraft: null, ...remember(s) });
            return drawn[0]!.id;
        },
        startLink(from) {
            const s = get();
            const node = s.nodes[from];
            if (!node) {
                return;
            }
            set({ linkDraft: { from, to: center(node), aiming: true }, selection: [from] });
        },
        removeEdge(id) {
            set((s) => ({ edges: s.edges.filter((edge) => edge.id !== id), selection: s.selection.filter((selected) => selected !== id), ...remember(s) }));
        },
        setEdgeLabel(id, label) {
            set((s) => ({ edges: s.edges.map((edge) => (edge.id === id ? { ...edge, label: label.trim() || undefined } : edge)) }));
        },
        setLinkDraft(draft) {
            set({ linkDraft: draft });
        }
    };
}
