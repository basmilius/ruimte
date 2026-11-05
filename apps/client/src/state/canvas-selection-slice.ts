import { lineBounds } from '@/canvas-model/line-geometry';
import { intersects } from '@/canvas-model/math';
import type { CanvasState } from '@/state/canvas';
import { maximizedNodeOf, type CanvasGet, type CanvasSet } from '@/state/canvas-model';
import { mergeSelection } from '@/state/selection';

/* What is selected, which node has the keyboard and which one fills the canvas. */
export function createCanvasSelectionSlice(
    set: CanvasSet,
    get: CanvasGet
): Pick<CanvasState, 'select' | 'clearSelection' | 'selectInRect' | 'activateNode' | 'setBodyFocus' | 'focusCard' | 'toggleMaximizedNode'> {
    return {
        select(ids, additive = false) {
            set((state) => {
                const selection = mergeSelection(state.selection, ids, additive ? 'toggle' : 'replace');
                const last = ids.findLast((id) => state.nodes[id] !== undefined && selection.includes(id));
                return {
                    selection,
                    navigationId: last ?? (state.navigationId !== null && selection.includes(state.navigationId) ? state.navigationId : null)
                };
            });
        },
        clearSelection() {
            set({ selection: [], navigationId: null });
        },
        selectInRect(rect, additive = false) {
            const { nodes, texts, lines, selection, hidden } = get();
            // A node inside a collapsed group is not drawn, so a box drawn over it cannot take it along.
            const hits = [
                ...Object.values(nodes)
                    .filter((node) => !hidden.has(node.id) && intersects(node, rect))
                    .map((node) => node.id),
                ...Object.values(texts)
                    .filter((text) => !hidden.has(text.id) && intersects({ x: text.x, y: text.y, w: text.size * 8, h: text.size * 1.4 }, rect))
                    .map((text) => text.id),
                ...Object.values(lines)
                    .filter((line) => !hidden.has(line.id) && intersects(lineBounds(line), rect))
                    .map((line) => line.id)
            ];
            set({ selection: mergeSelection(selection, hits, additive ? 'add' : 'replace') });
        },
        activateNode(id) {
            get().bringToFront(id);
            set({ selection: [id], navigationId: id, bodyFocusId: id, editingTextId: null });
        },
        setBodyFocus(id) {
            set({ bodyFocusId: id, ...(id === null ? {} : { navigationId: id }) });
        },
        focusCard(id) {
            const card = get().derivedCards[id];
            if (card !== undefined) {
                set({ bodyFocusId: card.owner, navigationId: id, editingTextId: null });
            }
        },
        toggleMaximizedNode(id) {
            if (maximizedNodeOf(get()) === id) {
                set({ maximizedId: null });
                return;
            }
            get().activateNode(id);
            set({ maximizedId: id });
        }
    };
}
