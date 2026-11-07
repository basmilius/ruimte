import { lineBounds } from '@/canvas/line-geometry';
import { intersects } from '@/canvas/math';
import { cameraToReveal } from '@/canvas/node-navigation';
import type { CanvasState } from '@/state/canvas';
import { maximizedNodeOf, type CanvasGet, type CanvasSet } from '@/state/canvas-model';
import { announceActivation } from '@/state/node-activation';
import { mergeSelection } from '@/state/selection';

/* What is selected, which node has the keyboard and which one fills the canvas. */
export function createCanvasSelectionSlice(
    set: CanvasSet,
    get: CanvasGet
): Pick<CanvasState, 'select' | 'clearSelection' | 'selectInRect' | 'activateNode' | 'setBodyFocus' | 'focusCard' | 'revealCard' | 'toggleMaximizedNode'> {
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
            announceActivation(id);
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
        revealCard(id) {
            const { derivedCards, camera, viewport } = get();
            const card = derivedCards[id];
            // A viewport of zero is a canvas not laid out yet, where there is nothing to reveal in.
            if (card === undefined || viewport.w <= 0 || viewport.h <= 0) {
                return;
            }
            const next = cameraToReveal(card.rect, camera, viewport);
            if (next.x !== camera.x || next.y !== camera.y) {
                set({ camera: next });
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
