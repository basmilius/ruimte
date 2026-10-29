import { cameraCenteredOn, cameraToFit, toWorld } from '@/canvas/math';
import { cameraToReveal, neighboringNode } from '@/canvas/node-navigation';
import type { CanvasState } from '@/state/canvas';
import { maximizedNodeOf, zoomNodeTargetOf, type CanvasGet, type CanvasSet } from '@/state/canvas-model';

/* Where the camera goes to show one node, and which node the arrow keys select next. */
export function createCanvasNavigationSlice(set: CanvasSet, get: CanvasGet): Pick<CanvasState, 'goToNode' | 'zoomToNode' | 'selectNeighbor'> {
    return {
        goToNode(id, { fit = false } = {}) {
            const { nodes, viewport, camera, maximizedId } = get();
            const node = nodes[id];
            if (!node) {
                return;
            }
            const next = fit ? cameraToFit(node, viewport, 48, 1) : cameraCenteredOn(node, viewport, Math.max(camera.zoom, 0.75));
            /* Revealing a node on another view switches to it first, which makes the editor this
           runs on one frame old, so it waits for the size rather than landing in the corner. */
            set({
                ...(next === null ? { pendingCamera: fit ? { kind: 'node', id, fit } : { kind: 'node', id } } : { camera: next, pendingCamera: null }),
                // Another node would land under the maximized one.
                ...(maximizedId !== id ? { maximizedId: null } : {}),
                selection: [id]
            });
        },
        zoomToNode(id) {
            const state = get();
            const target = id ?? zoomNodeTargetOf(state);
            const node = target === null || target === undefined ? undefined : state.nodes[target];
            if (!node || state.hidden.has(node.id) || maximizedNodeOf(state) !== null || state.gesturing) {
                return;
            }
            const camera = cameraToFit(node, state.viewport, 48, 1);
            if (camera !== null) {
                set({ camera, pendingCamera: null });
            }
        },
        selectNeighbor(direction) {
            const state = get();
            if (maximizedNodeOf(state) !== null || state.gesturing) {
                return;
            }
            const onCard = state.navigationId !== null && state.derivedCards[state.navigationId] !== undefined;
            const from =
                state.navigationId !== null && (onCard || state.selection.includes(state.navigationId))
                    ? state.navigationId
                    : (state.selection.find((id) => state.nodes[id] !== undefined) ?? null);
            // The cards beside a node are stops too, where they stand, and never selected: nothing moves or removes one.
            const cards = Object.entries(state.derivedCards)
                .filter(([, card]) => state.nodes[card.owner] !== undefined && !state.hidden.has(card.owner))
                .map(([id, card]) => ({ id, ...card.rect }));
            const target = neighboringNode(
                [...Object.values(state.nodes).filter((node) => !state.hidden.has(node.id)), ...cards],
                from,
                direction,
                toWorld(state.camera, { x: state.viewport.w / 2, y: state.viewport.h / 2 })
            );
            const rect = target === null ? undefined : (state.nodes[target] ?? state.derivedCards[target]?.rect);
            if (target === null || rect === undefined) {
                return;
            }
            const camera = state.viewport.w > 0 && state.viewport.h > 0 ? cameraToReveal(rect, state.camera, state.viewport) : state.camera;
            const selection = state.nodes[target] === undefined ? [] : [target];
            set({ selection, navigationId: target, bodyFocusId: null, camera });
        }
    };
}
