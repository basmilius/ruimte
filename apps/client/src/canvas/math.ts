export interface Camera {
    x: number;
    y: number;
    zoom: number;
}

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface Point {
    x: number;
    y: number;
}

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const GRID = 8;

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

export const unionRect = (rects: Rect[]): Rect | null => {
    if (rects.length === 0) {
        return null;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rects) {
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.w);
        maxY = Math.max(maxY, r.y + r.h);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

export const intersects = (a: Rect, b: Rect): boolean =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const cameraToFit = (bounds: Rect, viewport: { w: number; h: number }, padding = 96, maxZoom = 1): Camera => {
    const zoom = clampZoom(Math.min(
        (viewport.w - padding * 2) / bounds.w,
        (viewport.h - padding * 2) / bounds.h,
        maxZoom
    ));
    return {
        zoom,
        x: (viewport.w - bounds.w * zoom) / 2 - bounds.x * zoom,
        y: (viewport.h - bounds.h * zoom) / 2 - bounds.y * zoom
    };
};

export const cameraCenteredOn = (rect: Rect, viewport: { w: number; h: number }, zoom: number): Camera => ({
    zoom,
    x: viewport.w / 2 - (rect.x + rect.w / 2) * zoom,
    y: viewport.h / 2 - (rect.y + rect.h / 2) * zoom
});

export const ZOOM_PRESETS = [25, 50, 75, 100, 150, 200] as const;

/* Compared on the rounded percent the readout shows, so 0.999 still ticks 100%. */
export const activeZoomPreset = (zoom: number): number | null =>
    ZOOM_PRESETS.find((p) => p === Math.round(zoom * 100)) ?? null;
