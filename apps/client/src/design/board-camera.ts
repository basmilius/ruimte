import { createStore, type StoreApi } from 'zustand';
import { createCameraSlice, type CameraSlice } from '@/canvas-model/camera-slice';
import type { Point } from '@/canvas-model/math';
import type { FrameClock } from '@/surface/canvas/pan-batch';
import { createWheelCamera, type WheelInput } from '@/surface/canvas/use-wheel-camera';

export interface BoardCamera {
    store: StoreApi<CameraSlice>;
    /* A wheel the page handed on, at its point in the page, which is the stage's point too. */
    wheel(input: WheelInput, at: Point): void;
    /* A drag that pans, by what it moved since the last one. */
    pan(dx: number, dy: number): void;
    dispose(): void;
}

/*
 * The camera of a design board, worked out the way a Ruimte canvas works out its own: the page runs in a
 * sandbox, so it hands its wheel and drags here and draws the camera this sends back. Only the page can
 * measure the board, so a fit stays the page's and the camera it then reports is set here.
 */
export function createBoardCamera(frames?: FrameClock): BoardCamera {
    const store = createStore<CameraSlice>((set, get) => createCameraSlice(set, get, { boundsOfAll: () => null, boundsOfSelection: () => null }));
    const wheels = createWheelCamera<WheelInput>(store, () => ({}), frames);

    return {
        store,
        wheel: (input, at) => {
            wheels.wheel(input, () => at);
        },
        pan: (dx, dy) => {
            wheels.flush();
            store.getState().panBy(dx, dy);
        },
        dispose: () => wheels.dispose()
    };
}
