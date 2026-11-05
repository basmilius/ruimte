import { useLayoutEffect, type RefObject } from 'react';
import type { StoreApi } from 'zustand';
import type { CameraSlice } from '@/canvas-model/camera-slice';

/* Keeps the store's viewport at the size of the element a drawing or a diagram is drawn in. */
export function useViewportSize(rootRef: RefObject<HTMLElement | null>, store: StoreApi<CameraSlice>): void {
    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root) {
            return;
        }

        const observer = new ResizeObserver(([entry]) => {
            store.getState().setViewport({ w: entry!.contentRect.width, h: entry!.contentRect.height });
        });
        observer.observe(root);

        return () => observer.disconnect();
    }, [rootRef, store]);
}
