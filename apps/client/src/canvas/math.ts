import { CANVAS_GRID, type ViewCamera } from '@ruimte/contracts';

import { intersects, unionOf, type Point, type Rect } from '@ruimte/drawing';

/*
 * This module is what a camera does with the world it looks at. The world itself is one geometry,
 * in `@ruimte/drawing`, and passes through here so a reader on the canvas has one import for both.
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

export const clampZoom = (zoom: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

export const snapToGrid = (value: number): number => Math.round(value / GRID) * GRID;

/* Whole percent, so + and - after a pinch return to where they started. */
export const snapZoom = (zoom: number): number => clampZoom(Math.round(zoom * 100) / 100);

export const toWorld = (camera: Camera, screen: Point): Point => ({
    x: (screen.x - camera.x) / camera.zoom,
    y: (screen.y - camera.y) / camera.zoom
});

/* Zoom around a screen anchor so the world point under it stays put. */
export const zoomAround = (camera: Camera, nextZoom: number, anchor: Point): Camera => {
    const zoom = clampZoom(nextZoom);
    const ratio = zoom / camera.zoom;
    return {
        zoom,
        x: anchor.x - (anchor.x - camera.x) * ratio,
        y: anchor.y - (anchor.y - camera.y) * ratio
    };
};

/*
 * What the camera has in front of it, in world coordinates. The margin is screen pixels around the
 * edge: a renderer keeps a band there so a node does not flicker as it crosses, and a question about
 * what a person has really seen passes none.
 */
export const visibleRect = (camera: Camera, viewport: { w: number; h: number }, margin = 0): Rect => {
    const edge = margin / camera.zoom;
    return {
        x: -camera.x / camera.zoom - edge,
        y: -camera.y / camera.zoom - edge,
        w: viewport.w / camera.zoom + edge * 2,
        h: viewport.h / camera.zoom + edge * 2
    };
};

/*
 * Whether an element has been measured. An editor exists from the moment its view goes into a cell,
 * which is a frame before the element that holds it has a size, and the middle of nothing is the
 * corner: a camera worked out against a zero viewport parks what it was aimed at in the top left.
 * The two builders below answer null there, so a caller has to say what it does with "not yet".
 */
export const isMeasured = (viewport: { w: number; h: number }): boolean => viewport.w > 0 && viewport.h > 0;

export const cameraToFit = (bounds: Rect, viewport: { w: number; h: number }, padding = 96, maxZoom = 1): Camera | null => {
    if (!isMeasured(viewport)) {
        return null;
    }
    const zoom = clampZoom(Math.min((viewport.w - padding * 2) / bounds.w, (viewport.h - padding * 2) / bounds.h, maxZoom));
    return {
        zoom,
        x: (viewport.w - bounds.w * zoom) / 2 - bounds.x * zoom,
        y: (viewport.h - bounds.h * zoom) / 2 - bounds.y * zoom
    };
};

export const cameraCenteredOn = (rect: Rect, viewport: { w: number; h: number }, zoom: number): Camera | null =>
    isMeasured(viewport)
        ? {
              zoom,
              x: viewport.w / 2 - (rect.x + rect.w / 2) * zoom,
              y: viewport.h / 2 - (rect.y + rect.h / 2) * zoom
          }
        : null;

/* The camera the way it is stored: the world point in the middle of the viewport, so a cell of another size keeps that point in front. */
export const viewCameraOf = (camera: Camera, viewport: { w: number; h: number }): ViewCamera | null =>
    isMeasured(viewport) ? { center: toWorld(camera, { x: viewport.w / 2, y: viewport.h / 2 }), zoom: camera.zoom } : null;

export const cameraOfView = (view: ViewCamera, viewport: { w: number; h: number }): Camera | null =>
    isMeasured(viewport)
        ? {
              zoom: view.zoom,
              x: viewport.w / 2 - view.center.x * view.zoom,
              y: viewport.h / 2 - view.center.y * view.zoom
          }
        : null;

export const ZOOM_PRESETS = [25, 50, 75, 100, 150, 200] as const;

/* Compared on the rounded percent the readout shows, so 0.999 still ticks 100%. */
export const activeZoomPreset = (zoom: number): number | null => ZOOM_PRESETS.find((p) => p === Math.round(zoom * 100)) ?? null;
