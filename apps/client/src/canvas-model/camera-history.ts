import type { Camera } from '@/canvas-model/math';

/* A place the camera was, and the node it had been taken to when it got there (null where a person panned). */
interface CameraStop {
    camera: Camera;
    nodeId: string | null;
}

export interface CameraHistory {
    back: CameraStop[];
    forward: CameraStop[];
    /* The node the camera stands at now, or null where it was moved by hand. */
    at: string | null;
    /* A run of pans and zooms that counts as one move: where it began and when it last moved. */
    burst: { from: CameraStop; lastAt: number } | null;
}

export const CAMERA_HISTORY_LIMIT = 30;
export const BURST_QUIET_MS = 400;

// Under this many world pixels, and a zoom within 1%, the camera did not go anywhere worth coming back to.
const SAME_PLACE_PIXELS = 8;
const SAME_PLACE_ZOOM = 0.01;

export function emptyCameraHistory(): CameraHistory {
    return { back: [], forward: [], at: null, burst: null };
}

export function samePlace(a: Camera, b: Camera): boolean {
    const pixels = Math.hypot(a.x - b.x, a.y - b.y) / Math.max(a.zoom, 1e-6);
    return pixels < SAME_PLACE_PIXELS && Math.abs(a.zoom / b.zoom - 1) <= SAME_PLACE_ZOOM;
}

function capped(stops: CameraStop[]): CameraStop[] {
    return stops.length > CAMERA_HISTORY_LIMIT ? stops.slice(stops.length - CAMERA_HISTORY_LIMIT) : stops;
}

/* Ends the open burst against where the camera is now. */
export function settle(history: CameraHistory, current: Camera): CameraHistory {
    const burst = history.burst;
    if (burst === null) {
        return history;
    }
    if (samePlace(burst.from.camera, current)) {
        return { ...history, burst: null };
    }
    return { ...history, back: capped([...history.back, burst.from]), forward: [], at: null, burst: null };
}

/* The camera is taken `from` one place `to` another, to a node or to the whole canvas. A jump that stays put is not one. */
export function noteJump(history: CameraHistory, from: Camera, to: Camera, toNodeId: string | null): CameraHistory {
    const settled = settle(history, from);
    if (samePlace(from, to)) {
        return settled;
    }
    return { ...settled, back: capped([...settled.back, { camera: from, nodeId: settled.at }]), forward: [], at: toNodeId, burst: null };
}

/* A pan or zoom is about to move the camera from `current`. */
export function noteMove(history: CameraHistory, current: Camera, at: number): CameraHistory {
    if (history.burst !== null && at - history.burst.lastAt <= BURST_QUIET_MS) {
        return { ...history, burst: { ...history.burst, lastAt: at } };
    }
    const settled = settle(history, current);
    return { ...settled, burst: { from: { camera: current, nodeId: settled.at }, lastAt: at } };
}

/*
 * One step through the history. A stop whose node is gone is dropped on the way, so a target that
 * vanished is skipped instead of leading nowhere. Null where there is nothing left in that direction.
 */
export function step(
    history: CameraHistory,
    direction: -1 | 1,
    current: Camera,
    exists: (nodeId: string) => boolean
): { history: CameraHistory; to: CameraStop } | null {
    const settled = settle(history, current);
    const from = direction === -1 ? [...settled.back] : [...settled.forward];
    let to: CameraStop | undefined;
    while ((to = from.pop()) !== undefined) {
        if (to.nodeId === null || exists(to.nodeId)) {
            break;
        }
    }
    if (to === undefined) {
        return null;
    }
    const here: CameraStop = { camera: current, nodeId: settled.at };
    const moved = direction === -1 ? { back: from, forward: capped([...settled.forward, here]) } : { back: capped([...settled.back, here]), forward: from };
    return { history: { ...settled, ...moved, at: to.nodeId, burst: null }, to };
}
