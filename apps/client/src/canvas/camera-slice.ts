import type { ViewCamera } from '@ruimte/contracts';
import { cameraOfView, cameraToFit, clampZoom, isMeasured, snapZoom, viewCameraOf, zoomAround, type Camera, type Point, type Rect } from '@/canvas/math';

export interface Viewport {
    w: number;
    h: number;
}

/*
 * Where the camera goes the moment the surface has a size. An editor exists from the frame its view
 * lands in a cell, which is before the element holding it has been measured, and a camera worked out
 * against nothing parks what it was aimed at in the corner.
 */
export type CameraRequest = { kind: 'fit' } | { kind: 'node'; id: string } | { kind: 'view'; view: ViewCamera };

/* What every surface with a camera holds. A canvas, a drawing and a diagram hold exactly these. */
export interface CameraFields {
    camera: Camera;
    viewport: Viewport;
    pendingCamera: CameraRequest | null;
}

export interface CameraActions {
    setViewport(viewport: Viewport): void;
    setCamera(camera: Camera): void;
    panBy(dx: number, dy: number): void;
    zoomAt(factor: number, anchor: Point): void;
    settleZoom(anchor: Point): void;
    zoomTo(zoom: number, anchor?: Point): void;
    fitAll(): void;
    zoomToSelection(): void;
    viewCamera(): ViewCamera | null;
}

export type CameraSlice = CameraFields & CameraActions;

/* The two questions the slice cannot answer itself, because only the surface knows what it holds. */
interface CameraSurface<TState extends CameraSlice> {
    /* Everything on the surface, or null when there is nothing to fit. */
    boundsOfAll(state: TState): Rect | null;
    /* What zooming to the selection fits, or null when nothing is selected. */
    boundsOfSelection(state: TState): Rect | null;
    /*
     * A camera this surface asked for that the two shared kinds do not cover, now that there is a
     * size to work it out against. The canvas reveals a node that way.
     */
    resume?(state: TState, request: CameraRequest): void;
}

/*
 * The camera of a canvas, a drawing and a diagram: the same pan, the same zoom, the same wait for a
 * first size. A surface spreads this into its store and says what its bounds are.
 */
export const createCameraSlice = <TState extends CameraSlice>(
    set: (partial: Partial<CameraFields>) => void,
    get: () => TState,
    surface: CameraSurface<TState>
): CameraSlice => ({
    camera: { x: 0, y: 0, zoom: 1 },
    viewport: { w: 0, h: 0 },
    pendingCamera: null,

    setViewport(viewport) {
        // The size is the answer to whatever was waiting for one, so the wait ends here.
        const waiting = isMeasured(viewport) ? get().pendingCamera : null;
        set({ viewport });
        if (waiting === null) {
            return;
        }
        if (waiting.kind === 'fit') {
            get().fitAll();
        } else if (waiting.kind === 'view') {
            set({ camera: cameraOfView(waiting.view, viewport)!, pendingCamera: null });
        } else {
            surface.resume?.(get(), waiting);
        }
    },
    setCamera(camera) {
        set({ camera });
    },
    panBy(dx, dy) {
        const { camera } = get();
        set({ camera: { ...camera, x: camera.x + dx, y: camera.y + dy } });
    },
    zoomAt(factor, anchor) {
        const { camera } = get();
        set({ camera: zoomAround(camera, camera.zoom * factor, anchor) });
    },
    settleZoom(anchor) {
        const { camera } = get();
        const target = snapZoom(camera.zoom);
        if (target !== camera.zoom) {
            set({ camera: zoomAround(camera, target, anchor) });
        }
    },
    zoomTo(zoom, anchor) {
        const { camera, viewport } = get();
        set({ camera: zoomAround(camera, clampZoom(zoom), anchor ?? { x: viewport.w / 2, y: viewport.h / 2 }) });
    },
    fitAll() {
        const state = get();
        const bounds = surface.boundsOfAll(state);
        // An empty surface has nothing to fit, so the wait ends rather than standing forever.
        if (bounds === null) {
            set({ pendingCamera: null });
            return;
        }
        const camera = cameraToFit(bounds, state.viewport);
        set(camera === null ? { pendingCamera: { kind: 'fit' } } : { camera, pendingCamera: null });
    },
    zoomToSelection() {
        const state = get();
        const bounds = surface.boundsOfSelection(state);
        const camera = bounds === null ? null : cameraToFit(bounds, state.viewport, 96, 1.5);
        // A shortcut on a surface nobody can see yet is worth nothing later, so this one does not wait.
        if (camera !== null) {
            set({ camera, pendingCamera: null });
        }
    },
    viewCamera() {
        const { camera, viewport, pendingCamera } = get();
        return pendingCamera?.kind === 'view' ? pendingCamera.view : viewCameraOf(camera, viewport);
    }
});
