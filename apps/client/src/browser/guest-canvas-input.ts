import type { StoreApi } from 'zustand';
import { maximizedNodeOf, type CanvasState } from '@/state/canvas';
import { setGapModifierDown } from '@/canvas/gap-modifier';
import type { Point } from '@/canvas/math';

export function createGuestCanvasInput(nodeId: string, canvas: () => StoreApi<CanvasState> | null, leave: () => void) {
    let pointer: { store: StoreApi<CanvasState>; last: Point } | null = null;
    const end = (): void => {
        const store = pointer?.store;
        pointer = null;
        store?.getState().setPanning(false);
        store?.getState().setGesturing(false);
    };
    return {
        isPanning(): boolean {
            return pointer !== null;
        },
        end,
        handle(channel: string, payload: unknown): void {
            if (channel === 'ruimte:canvas-alt' && payload === false) {
                setGapModifierDown(false);
                return;
            }
            const store = canvas();
            const state = store?.getState();
            if (channel === 'ruimte:canvas-pan') {
                const sample = payload as { phase?: string; x?: number; y?: number } | null;
                if (sample?.phase === 'end') {
                    end();
                    return;
                }
                if (!sample || typeof sample.x !== 'number' || typeof sample.y !== 'number' || !Number.isFinite(sample.x) || !Number.isFinite(sample.y)) {
                    return;
                }
                const point = { x: sample.x, y: sample.y };
                if (
                    sample.phase === 'start' &&
                    store &&
                    state &&
                    state.nodes[nodeId] !== undefined &&
                    !state.hidden.has(nodeId) &&
                    !state.locks.pan &&
                    !state.gesturing &&
                    maximizedNodeOf(state) === null
                ) {
                    pointer = { store, last: point };
                    state.setGesturing(true);
                    state.setPanning(true);
                } else if (sample.phase === 'move' && pointer !== null) {
                    if (store !== pointer.store || pointer.store.getState().locks.pan) {
                        end();
                        return;
                    }
                    pointer.store.getState().panBy(point.x - pointer.last.x, point.y - pointer.last.y);
                    pointer.last = point;
                }
                return;
            }
            if (!state || state.nodes[nodeId] === undefined || state.hidden.has(nodeId)) {
                return;
            }
            if (channel === 'ruimte:canvas-zoom' && !state.gesturing) {
                state.zoomToNode(nodeId);
            } else if (channel === 'ruimte:canvas-leave' && state.bodyFocusId === nodeId) {
                state.setBodyFocus(null);
                leave();
            } else if (channel === 'ruimte:canvas-alt' && typeof payload === 'boolean') {
                setGapModifierDown(payload);
            }
        }
    };
}
