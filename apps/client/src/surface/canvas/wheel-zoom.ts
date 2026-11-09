import { clampZoom, type Point } from '@/canvas-model/math';
import { windowFrames, type FrameClock } from '@/surface/canvas/pan-batch';

/* The zoom one notch of a mouse wheel takes: ten percent, so a few notches cross a node rather than the whole canvas. */
export const NOTCH_FACTOR = 1.1;

/* What Chromium reports for one notch in pixels, on every platform at a scale of 100%. */
const PIXELS_PER_NOTCH = 100;

/*
 * Below this a delta is a trackpad pinch or a smooth wheel, which arrives as many small events.
 * A notch of a mouse wheel arrives as one event of about a hundred pixels, more under display scaling.
 */
const NOTCH_MIN_PIXELS = 40;

/* The most a single pinch event may zoom by, so one coarse event from a driver never jumps. */
const PINCH_MAX_DELTA = 25;

/* Pixels per line and per page, for a wheel that reports in either. */
const LINE_PIXELS = 16;
const PAGE_PIXELS = 800;

/* The share of what is left of a glide that each frame takes: about 120 ms to arrive at 60 frames a second. */
const GLIDE_SHARE = 0.35;

/* Close enough in log space to land on the target and stop. */
const GLIDE_DONE = 0.002;

type WheelZoom = { kind: 'notch'; factor: number } | { kind: 'pinch'; factor: number };

function pixelsOf(deltaY: number, deltaMode: number): number {
    return deltaMode === 1 ? deltaY * LINE_PIXELS : deltaMode === 2 ? deltaY * PAGE_PIXELS : deltaY;
}

/*
 * What a wheel event with the zoom modifier asks for. A notch of a mouse wheel is a fixed step, glided
 * to; a pinch follows the fingers event by event.
 */
export function wheelZoomOf(event: { deltaY: number; deltaMode: number }): WheelZoom {
    const pixels = pixelsOf(event.deltaY, event.deltaMode);
    if (event.deltaMode !== 0 || Math.abs(pixels) >= NOTCH_MIN_PIXELS) {
        const notches = Math.max(1, Math.round(Math.abs(pixels) / PIXELS_PER_NOTCH));
        return { kind: 'notch', factor: NOTCH_FACTOR ** (pixels < 0 ? notches : -notches) };
    }
    const delta = Math.max(-PINCH_MAX_DELTA, Math.min(PINCH_MAX_DELTA, pixels));
    return { kind: 'pinch', factor: Math.exp(-delta * 0.01) };
}

interface ZoomGlideCamera {
    zoom(): number;
    zoomAt(factor: number, anchor: Point): void;
}

interface ZoomGlide {
    /* Adds a step to where the glide is headed, around the point under the pointer. */
    add(factor: number, anchor: Point): void;
    /* Stops where the camera is now, without settling. */
    stop(): void;
}

/*
 * Moves the zoom toward a target over a few frames instead of in one jump. Notches that come in while
 * it moves add to the target rather than to the camera, so a quick turn of the wheel lands exactly as
 * far as its notches say. Once it arrives it hands the anchor on, for the zoom to settle on a whole percent.
 */
export function createZoomGlide(camera: ZoomGlideCamera, onArrived: (anchor: Point) => void, frames: FrameClock = windowFrames): ZoomGlide {
    let target: number | null = null;
    let anchor: Point = { x: 0, y: 0 };
    let frame: number | null = null;

    const step = (): void => {
        frame = null;
        if (target === null) {
            return;
        }
        const current = camera.zoom();
        const remaining = Math.log(target / current);
        if (Math.abs(remaining) <= GLIDE_DONE) {
            camera.zoomAt(target / current, anchor);
            target = null;
            onArrived(anchor);
            return;
        }
        camera.zoomAt(Math.exp(remaining * GLIDE_SHARE), anchor);
        frame = frames.request(step);
    };

    return {
        add(factor, at) {
            target = clampZoom((target ?? camera.zoom()) * factor);
            anchor = at;
            frame ??= frames.request(step);
        },
        stop() {
            if (frame !== null) {
                frames.cancel(frame);
                frame = null;
            }
            target = null;
        }
    };
}
