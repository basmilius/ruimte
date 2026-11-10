import type { StoreApi } from 'zustand';
import { toWorld, type Point } from '@/canvas-model/math';
import type { CanvasState } from '@/state/canvas';

/* Kept beside the store and not in it, since every move of the pointer would wake whatever reads the canvas. */
const pointers = new WeakMap<StoreApi<CanvasState>, Point>();

/* Where the pointer is over a canvas, in screen units from its top left corner; null once it left. */
export function notePointer(store: StoreApi<CanvasState>, point: Point | null): void {
    if (point === null) {
        pointers.delete(store);
    } else {
        pointers.set(store, point);
    }
}

/* Read through the camera as it is now, so a pan or a zoom since the last move counts. */
export function pointerInWorld(store: StoreApi<CanvasState>): Point | null {
    const point = pointers.get(store);
    return point === undefined ? null : toWorld(store.getState().camera, point);
}
