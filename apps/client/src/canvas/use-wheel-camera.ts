import { useEffect, useRef, type RefObject } from 'react';
import type { StoreApi } from 'zustand';
import type { CameraSlice } from '@/canvas/camera-slice';
import { isApplePlatform } from '@/desktop/bridge';
import { isModHeld } from '@ruimte/ui/shortcut';
import { createPanBatch } from '@/canvas/pan-batch';

/* How long after the last wheel event a zoom settles on a whole percent. */
const ZOOM_SETTLE_MS = 160;

/* Chromium reports a trackpad pinch as a wheel with Ctrl held on every platform, so Ctrl always
   zooms and Cmd joins it on macOS; the Windows key never does. */
const wheelZooms = (e: WheelEvent): boolean => e.ctrlKey || isModHeld(e, isApplePlatform());

export interface WheelCameraOptions {
    /* A canvas refuses a pan or a zoom while that lock is on; a drawing and a diagram have none. */
    locks?: () => { pan: boolean; zoom: boolean };
    /* True when the wheel belongs to something on the surface rather than to the camera. */
    defer?: (e: WheelEvent, zooming: boolean) => boolean;
}

/*
 * The wheel over a canvas, a drawing or a diagram: two fingers pan, a pinch zooms around the pointer
 * and the zoom settles on a whole percent once the fingers stop. React registers wheel listeners as
 * passive, so `preventDefault` there cannot stop the browser's own pinch zoom: this takes a native,
 * non-passive one, in the capture phase, because a scrollable body inside (a terminal's scrollback,
 * a thread) scrolls itself rather than through a default that could be prevented, and would
 * otherwise scroll and pan at once.
 */
export const useWheelCamera = (rootRef: RefObject<HTMLElement | null>, store: StoreApi<CameraSlice>, options: WheelCameraOptions = {}): void => {
    const latest = useRef(options);

    useEffect(() => {
        latest.current = options;
    });

    useEffect(() => {
        const root = rootRef.current;
        if (!root) {
            return;
        }
        let anchor = { x: 0, y: 0 };
        let timer: number | null = null;
        // Only a zoom settles. Without this a pan right after one would snap the camera back.
        let zoomed = false;
        const pan = createPanBatch((dx, dy) => store.getState().panBy(dx, dy));

        const onWheel = (e: WheelEvent): void => {
            const zooming = wheelZooms(e);
            if (latest.current.defer?.(e, zooming) === true) {
                return;
            }
            e.stopPropagation();
            e.preventDefault();
            const rect = root.getBoundingClientRect();
            const at = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            const locks = latest.current.locks?.();
            if (!zooming) {
                if (locks?.pan !== true) {
                    pan.add(-e.deltaX, -e.deltaY);
                }
                return;
            }
            if (locks?.zoom === true) {
                return;
            }
            pan.flush();
            store.getState().zoomAt(Math.exp(-e.deltaY * 0.01), at);
            anchor = at;
            zoomed = true;
            if (timer !== null) {
                window.clearTimeout(timer);
            }
            timer = window.setTimeout(() => {
                if (zoomed) {
                    store.getState().settleZoom(anchor);
                    zoomed = false;
                }
            }, ZOOM_SETTLE_MS);
        };
        /* Outside the surface (sidebar, dock) a pinch must not zoom the page either. */
        const swallowPinch = (e: WheelEvent): void => {
            if (wheelZooms(e) && !root.contains(e.target as Node)) {
                e.preventDefault();
            }
        };
        const swallowGesture = (e: Event): void => e.preventDefault();

        root.addEventListener('wheel', onWheel, { passive: false, capture: true });
        document.addEventListener('wheel', swallowPinch, { passive: false });
        document.addEventListener('gesturestart', swallowGesture);
        document.addEventListener('gesturechange', swallowGesture);
        return () => {
            pan.flush();
            if (timer !== null) {
                window.clearTimeout(timer);
            }
            root.removeEventListener('wheel', onWheel, { capture: true });
            document.removeEventListener('wheel', swallowPinch);
            document.removeEventListener('gesturestart', swallowGesture);
            document.removeEventListener('gesturechange', swallowGesture);
        };
    }, [rootRef, store]);
};
