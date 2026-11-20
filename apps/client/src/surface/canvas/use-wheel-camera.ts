import { isModHeld, isApplePlatform } from '@adecore/ui';
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { StoreApi } from 'zustand';
import type { CameraSlice } from '@/canvas-model/camera-slice';
import type { Point } from '@/canvas-model/math';
import { createPanBatch, windowFrames, type FrameClock } from '@/surface/canvas/pan-batch';
import { createWheelPanSession, PAN_IDLE_MS } from '@/surface/canvas/wheel-pan-session';
import { createZoomGlide, wheelZoomOf } from '@/surface/canvas/wheel-zoom';

const ZOOM_SETTLE_MS = 160;

/* What the camera reads of a wheel event, which a page in a frame hands over as plain data. */
export interface WheelInput {
    deltaX: number;
    deltaY: number;
    deltaMode: number;
    ctrlKey: boolean;
    metaKey: boolean;
    timeStamp: number;
}

/* Chromium reports a trackpad pinch as a wheel with Ctrl held on every platform, so Ctrl always
   zooms and Cmd joins it on macOS; the Windows key never does. */
export function wheelZooms(e: Pick<WheelInput, 'ctrlKey' | 'metaKey'>, apple = isApplePlatform()): boolean {
    return e.ctrlKey || isModHeld(e, apple);
}

interface WheelCameraOptions<TEvent extends WheelInput> {
    /* A canvas refuses a pan or a zoom while that lock is on; a drawing and a diagram have none. */
    locks?: () => { pan: boolean; zoom: boolean };
    /* True when the wheel belongs to something on the surface rather than to the camera. */
    defer?: (e: TEvent, zooming: boolean) => boolean;
    ownsWheel?: () => boolean;
    onPan?: (active: boolean) => void;
}

export interface WheelCamera<TEvent extends WheelInput> {
    /* Moves the camera for one wheel event at a point of the surface; false when the event was not the camera's. */
    wheel(e: TEvent, at: () => Point): boolean;
    /* Applies a pan that waits for its frame, so what comes next starts from the camera it leaves. */
    flush(): void;
    dispose(): void;
}

/*
 * The wheel over a canvas, a drawing, a diagram or a design board: two fingers pan, a pinch zooms around
 * the pointer and the zoom settles on a whole percent once the fingers stop. A notch of a mouse wheel with
 * the modifier is a small step the camera glides to (`wheel-zoom.ts`).
 */
export function createWheelCamera<TEvent extends WheelInput>(
    store: StoreApi<CameraSlice>,
    options: () => WheelCameraOptions<TEvent>,
    frames: FrameClock = windowFrames
): WheelCamera<TEvent> {
    let anchor = { x: 0, y: 0 };
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Only a zoom settles. Without this a pan right after one would snap the camera back.
    let zoomed = false;
    let panTimer: ReturnType<typeof setTimeout> | null = null;
    const pan = createPanBatch((dx, dy) => store.getState().panBy(dx, dy), frames);
    const session = createWheelPanSession();
    const glide = createZoomGlide(
        { zoom: () => store.getState().camera.zoom, zoomAt: (factor, at) => store.getState().zoomAt(factor, at) },
        (at) => store.getState().settleZoom(at),
        frames
    );

    const endPan = (): void => {
        session.reset();
        options().onPan?.(false);
    };

    const stopPanTimer = (): void => {
        if (panTimer !== null) {
            clearTimeout(panTimer);
            panTimer = null;
        }
    };

    const stopSettle = (): void => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };

    return {
        wheel(e, at) {
            const current = options();
            const zooming = wheelZooms(e);
            const owns = session.owns(current.ownsWheel?.() === true, e.timeStamp);

            if ((zooming || !owns) && current.defer?.(e, zooming) === true) {
                return false;
            }

            const point = at();
            const locks = current.locks?.();

            if (!zooming) {
                if (locks?.pan !== true) {
                    session.record(e.timeStamp);
                    current.onPan?.(true);
                    pan.add(-e.deltaX, -e.deltaY);
                    stopPanTimer();
                    panTimer = setTimeout(endPan, PAN_IDLE_MS);
                }

                return true;
            }

            if (locks?.zoom === true) {
                return true;
            }

            pan.flush();
            stopPanTimer();
            endPan();
            stopSettle();

            const step = wheelZoomOf(e);

            if (step.kind === 'notch') {
                // The glide settles once it arrives, so a settle due from an earlier pinch would only cut it short.
                zoomed = false;
                glide.add(step.factor, point);

                return true;
            }

            glide.stop();
            store.getState().zoomAt(step.factor, point);
            anchor = point;
            zoomed = true;
            timer = setTimeout(() => {
                if (zoomed) {
                    store.getState().settleZoom(anchor);
                    zoomed = false;
                }
            }, ZOOM_SETTLE_MS);

            return true;
        },
        flush: pan.flush,
        dispose() {
            pan.flush();
            glide.stop();
            stopPanTimer();
            endPan();
            stopSettle();
        }
    };
}

/*
 * `createWheelCamera` on a surface of this window. React's wheel listeners are passive and cannot stop the
 * browser's pinch zoom, so this is a native one, in the capture phase because a scrollable body inside (a
 * terminal's scrollback, a thread) would otherwise scroll and pan at once.
 */
export function useWheelCamera(rootRef: RefObject<HTMLElement | null>, store: StoreApi<CameraSlice>, options: WheelCameraOptions<WheelEvent> = {}): () => void {
    const latest = useRef(options);
    const flushRef = useRef<(() => void) | null>(null);

    useLayoutEffect(() => {
        latest.current = options;
    });

    useEffect(() => {
        const root = rootRef.current;
        if (!root) {
            return;
        }
        const camera = createWheelCamera<WheelEvent>(store, () => latest.current);
        flushRef.current = camera.flush;

        const onWheel = (e: WheelEvent): void => {
            const at = (): Point => {
                const rect = root.getBoundingClientRect();
                return { x: e.clientX - rect.left, y: e.clientY - rect.top };
            };
            if (camera.wheel(e, at)) {
                e.stopPropagation();
                e.preventDefault();
            }
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
            camera.dispose();
            flushRef.current = null;
            root.removeEventListener('wheel', onWheel, { capture: true });
            document.removeEventListener('wheel', swallowPinch);
            document.removeEventListener('gesturestart', swallowGesture);
            document.removeEventListener('gesturechange', swallowGesture);
        };
    }, [rootRef, store]);
    return () => flushRef.current?.();
}
