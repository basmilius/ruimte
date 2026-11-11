import type { Viewport } from '@/canvas-model/camera-slice';
import { visibleRect, type Camera } from '@/canvas-model/math';
import { useCanvasCamera, type CanvasState } from '@/state/canvas';
import { memoByIdentity } from '@/state/identity-memo';
import { useNodeInViewport } from '@/state/node-in-view';

/* `CanvasView` of `@ruimte/extension/client`. */
export interface CanvasView {
    visible: { x: number; y: number; width: number; height: number };
    zoom: number;
    gesture: 'none' | 'move' | 'line';
}

type Gesture = CanvasView['gesture'];

/* One object per camera, viewport and gesture, so a selector that answers the view itself draws again only when one of them changed. */
const viewsOf = memoByIdentity((_camera: Camera, _viewport: Viewport): Map<Gesture, CanvasView> => new Map());

function gestureOf(state: Pick<CanvasState, 'gesturing' | 'linkDraft'>): Gesture {
    if (state.linkDraft?.aiming === true) {
        return 'line';
    }

    return state.gesturing ? 'move' : 'none';
}

export function canvasViewOf(state: Pick<CanvasState, 'camera' | 'viewport' | 'gesturing' | 'linkDraft'>): CanvasView {
    const views = viewsOf(state.camera, state.viewport);
    const gesture = gestureOf(state);
    let view = views.get(gesture);

    if (view === undefined) {
        const rect = visibleRect(state.camera, state.viewport);

        view = { visible: { x: rect.x, y: rect.y, width: rect.w, height: rect.h }, zoom: state.camera.zoom, gesture };
        views.set(gesture, view);
    }

    return view;
}

/* The canvas a surface draws on, or the one in front: the camera's own store, since a pan moves nothing else. */
export function useCanvasViewOf<Value>(select: (view: CanvasView) => Value): Value {
    return useCanvasCamera((state) => select(canvasViewOf(state)));
}

export function useNodeInView(id: string): boolean {
    return useNodeInViewport(id);
}
