import { CANVAS_GRID, type ViewCamera } from '@ruimte/contracts';

import { centerOf, intersects, unionOf, type Point, type Rect } from '@adecore/drawing';

/*
 * This module is what a camera does with the world it looks at. The world itself is one geometry,
 * in `@adecore/drawing`, and passes through here so a reader on the canvas has one import for both.
 */
export { intersects, unionOf, type Point, type Rect };

export interface Camera {
    x: number;
    y: number;
    zoom: number;
}

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;
export const GRID = CANVAS_GRID;

/* Where the dots of the ground sit for a camera: three grid steps apart, and moving with the world. */
export function groundPlacement(camera: Camera): { backgroundSize: string; backgroundPosition: string; backgroundImage: string } {
    const step = GRID * 3 * camera.zoom;
    return {
        backgroundSize: `${step}px ${step}px`,
        backgroundPosition: `${camera.x}px ${camera.y}px`,
        backgroundImage: `radial-gradient(circle, color-mix(in srgb, var(--canvas-dot) ${dotStrength(step)}%, transparent) 1px, transparent 1px)`
    };
}

/* Dots drawn closer together than this start to fade, and are gone at the second: packed tight they turn into a texture. */
const DOTS_FULL_STEP = 18;
const DOTS_GONE_STEP = 6;

function dotStrength(step: number): number {
    const share = (step - DOTS_GONE_STEP) / (DOTS_FULL_STEP - DOTS_GONE_STEP);
    return Math.round(Math.min(1, Math.max(0, share)) * 100);
}

export function clampZoom(zoom: number): number {
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

export function snapToGrid(value: number, grid = GRID): number {
    return Math.round(value / grid) * grid;
}

export function snapPoint(point: Point, grid = GRID): Point {
    return { x: snapToGrid(point.x, grid), y: snapToGrid(point.y, grid) };
}

/* A line can overlap a span at one coordinate; two positive spans must share some length. */
export function overlapSpan(first: number, firstSize: number, second: number, secondSize: number): { low: number; high: number } | null {
    const low = Math.max(first, second);
    const high = Math.min(first + firstSize, second + secondSize);
    return high > low || (high === low && (firstSize === 0 || secondSize === 0)) ? { low, high } : null;
}

/* Whole percent, so + and - after a pinch return to where they started. */
export function snapZoom(zoom: number): number {
    return clampZoom(Math.round(zoom * 100) / 100);
}

export function toWorld(camera: Camera, screen: Point): Point {
    return {
        x: (screen.x - camera.x) / camera.zoom,
        y: (screen.y - camera.y) / camera.zoom
    };
}

/* Zoom around a screen anchor so the world point under it stays put. */
export function zoomAround(camera: Camera, nextZoom: number, anchor: Point): Camera {
    const zoom = clampZoom(nextZoom);
    const ratio = zoom / camera.zoom;
    return {
        zoom,
        x: anchor.x - (anchor.x - camera.x) * ratio,
        y: anchor.y - (anchor.y - camera.y) * ratio
    };
}

/*
 * What the camera has in front of it, in world coordinates. The margin is screen pixels around the
 * edge: a renderer keeps a band there so a node does not flicker as it crosses, and a question about
 * what a person has really seen passes none.
 */
export function visibleRect(camera: Camera, viewport: { w: number; h: number }, margin = 0): Rect {
    const edge = margin / camera.zoom;
    return {
        x: -camera.x / camera.zoom - edge,
        y: -camera.y / camera.zoom - edge,
        w: viewport.w / camera.zoom + edge * 2,
        h: viewport.h / camera.zoom + edge * 2
    };
}

/*
 * An editor exists a frame before its element has a size, and a camera worked out against a zero
 * viewport parks what it was aimed at in the top left. The builders below answer null until then.
 */
export function isMeasured(viewport: { w: number; h: number }): boolean {
    return viewport.w > 0 && viewport.h > 0;
}

export function cameraToFit(bounds: Rect, viewport: { w: number; h: number }, padding = 96, maxZoom = 1): Camera | null {
    if (!isMeasured(viewport)) {
        return null;
    }
    const zoom = clampZoom(Math.min((viewport.w - padding * 2) / bounds.w, (viewport.h - padding * 2) / bounds.h, maxZoom));
    return {
        zoom,
        x: (viewport.w - bounds.w * zoom) / 2 - bounds.x * zoom,
        y: (viewport.h - bounds.h * zoom) / 2 - bounds.y * zoom
    };
}

export function cameraCenteredOn(rect: Rect, viewport: { w: number; h: number }, zoom: number): Camera | null {
    return cameraOfView({ center: centerOf(rect), zoom }, viewport);
}

/* The camera the way it is stored: the world point in the middle of the viewport, so a cell of another size keeps that point in front. */
export function viewCameraOf(camera: Camera, viewport: { w: number; h: number }): ViewCamera | null {
    return isMeasured(viewport) ? { center: toWorld(camera, { x: viewport.w / 2, y: viewport.h / 2 }), zoom: camera.zoom } : null;
}

export function cameraOfView(view: ViewCamera, viewport: { w: number; h: number }): Camera | null {
    return isMeasured(viewport)
        ? {
              zoom: view.zoom,
              x: viewport.w / 2 - view.center.x * view.zoom,
              y: viewport.h / 2 - view.center.y * view.zoom
          }
        : null;
}
