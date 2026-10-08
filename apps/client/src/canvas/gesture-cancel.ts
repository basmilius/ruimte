import type { StoreApi } from 'zustand';
import type { CanvasState } from '@/state/canvas';

const cancellations = new Map<StoreApi<CanvasState>, () => boolean>();

// Escape is bound once per workspace, while each canvas owns its captured gesture.
export function registerGestureCancellation(store: StoreApi<CanvasState>, cancel: () => boolean): () => void {
    cancellations.set(store, cancel);
    return () => {
        cancellations.delete(store);
    };
}

export function cancelCanvasGesture(store: StoreApi<CanvasState>): boolean {
    return cancellations.get(store)?.() ?? false;
}
