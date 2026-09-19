import type { DrawingElement } from '@ruimte/contracts';

export interface Point {
    x: number;
    y: number;
}

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

export const boundsOf = (element: Pick<DrawingElement, 'x' | 'y' | 'w' | 'h'>): Rect => ({ x: element.x, y: element.y, w: element.w, h: element.h });

export const centerOf = (rect: Rect): Point => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

/* A point on the whole pixel, for a layout that lines its boxes and its lines up on a pixel grid. */
export const roundPoint = (point: Point): Point => ({ x: Math.round(point.x), y: Math.round(point.y) });

export const rotatePoint = (point: Point, around: Point, angle: number): Point => {
    if (angle === 0) {
        return point;
    }
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = point.x - around.x;
    const dy = point.y - around.y;
    return { x: around.x + dx * cos - dy * sin, y: around.y + dx * sin + dy * cos };
};

/* A point in the element's own frame, so every hit test can pretend nothing is turned. */
export const toLocal = (element: DrawingElement, point: Point): Point => rotatePoint(point, centerOf(boundsOf(element)), -(element.angle ?? 0));

export const unionOf = (rects: readonly Rect[]): Rect | null => {
    if (rects.length === 0) {
        return null;
    }
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const rect of rects) {
        left = Math.min(left, rect.x, rect.x + rect.w);
        top = Math.min(top, rect.y, rect.y + rect.h);
        right = Math.max(right, rect.x, rect.x + rect.w);
        bottom = Math.max(bottom, rect.y, rect.y + rect.h);
    }
    return { x: left, y: top, w: right - left, h: bottom - top };
};

export const boundsOfElements = (elements: readonly DrawingElement[]): Rect | null => unionOf(elements.map(boundsOf));

export const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const rectFromPoints = (from: Point, to: Point): Rect => ({
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    w: Math.abs(to.x - from.x),
    h: Math.abs(to.y - from.y)
});

export const distanceToSegment = (point: Point, a: Point, b: Point): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    if (length === 0) {
        return Math.hypot(point.x - a.x, point.y - a.y);
    }
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
    return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
};

export const absolutePoints = (element: DrawingElement): Point[] => {
    if (element.kind !== 'line' && element.kind !== 'freehand') {
        return [];
    }
    return element.points.map(([x, y]) => ({ x: element.x + x, y: element.y + y }));
};

const isFilled = (element: DrawingElement): boolean => element.fill !== undefined && element.fill !== 'none';

const cornersOfDiamond = (rect: Rect): Point[] => [
    { x: rect.x + rect.w / 2, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h / 2 },
    { x: rect.x + rect.w / 2, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h / 2 }
];

const insidePolygon = (point: Point, polygon: readonly Point[]): boolean => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i]!;
        const b = polygon[j]!;
        if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
    }
    return inside;
};

const nearPolygon = (point: Point, polygon: readonly Point[], tolerance: number): boolean =>
    polygon.some((corner, index) => distanceToSegment(point, corner, polygon[(index + 1) % polygon.length]!) <= tolerance);

const nearPolyline = (point: Point, points: readonly Point[], tolerance: number): boolean => {
    if (points.length === 1) {
        return Math.hypot(point.x - points[0]!.x, point.y - points[0]!.y) <= tolerance;
    }
    return points.slice(0, -1).some((from, index) => distanceToSegment(point, from, points[index + 1]!) <= tolerance);
};

const insideRect = (point: Point, rect: Rect): boolean => point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;

/*
 * Whether a point lands on an element. A shape with a fill is hit anywhere inside it, one without
 * only near its outline, which is what makes an empty rectangle easy to draw inside of.
 */
export const hitsElement = (element: DrawingElement, point: Point, tolerance: number): boolean => {
    const local = toLocal(element, point);
    const rect = boundsOf(element);
    const reach = Math.max(tolerance, element.strokeWidth);
    switch (element.kind) {
        // Both are their own sheet: anywhere on it is on them.
        case 'text':
        case 'note':
            return insideRect(local, rect);
        case 'rect': {
            const corners = [
                { x: rect.x, y: rect.y },
                { x: rect.x + rect.w, y: rect.y },
                { x: rect.x + rect.w, y: rect.y + rect.h },
                { x: rect.x, y: rect.y + rect.h }
            ];
            return isFilled(element) ? insideRect(local, rect) : nearPolygon(local, corners, reach);
        }
        case 'diamond': {
            const corners = cornersOfDiamond(rect);
            return isFilled(element) ? insidePolygon(local, corners) : nearPolygon(local, corners, reach);
        }
        case 'ellipse': {
            const center = centerOf(rect);
            const rx = Math.max(rect.w / 2, 0.01);
            const ry = Math.max(rect.h / 2, 0.01);
            const distance = Math.hypot((local.x - center.x) / rx, (local.y - center.y) / ry);
            if (isFilled(element)) {
                return distance <= 1;
            }
            return Math.abs(distance - 1) <= reach / Math.min(rx, ry);
        }
        case 'line':
        case 'freehand':
            return nearPolyline(local, absolutePoints(element), reach);
    }
};

export const elementAt = (elements: readonly DrawingElement[], point: Point, tolerance: number): DrawingElement | undefined => {
    for (let i = elements.length - 1; i >= 0; i--) {
        const element = elements[i]!;
        if (!element.locked && hitsElement(element, point, tolerance)) {
            return element;
        }
    }
    return undefined;
};

export const elementsIn = (elements: readonly DrawingElement[], rect: Rect): DrawingElement[] =>
    elements.filter((element) => !element.locked && intersects(boundsOf(element), rect));

export const handlePoint = (rect: Rect, handle: ResizeHandle): Point => {
    const x = handle.includes('w') ? rect.x : handle.includes('e') ? rect.x + rect.w : rect.x + rect.w / 2;
    const y = handle.startsWith('n') ? rect.y : handle.startsWith('s') ? rect.y + rect.h : rect.y + rect.h / 2;
    return { x, y };
};

/*
 * The box a resize drag makes: the handle follows the pointer and the side across from it stays
 * put. `aspect` keeps the proportions, which is what Shift asks for.
 */
export const resizeRect = (rect: Rect, handle: ResizeHandle, point: Point, aspect = false): Rect => {
    let { x, y, w, h } = rect;
    if (handle.includes('w')) {
        w = rect.x + rect.w - point.x;
        x = point.x;
    }
    if (handle.includes('e')) {
        w = point.x - rect.x;
    }
    if (handle.startsWith('n')) {
        h = rect.y + rect.h - point.y;
        y = point.y;
    }
    if (handle.startsWith('s')) {
        h = point.y - rect.y;
    }
    if (aspect && rect.w > 0 && rect.h > 0) {
        const ratio = rect.h / rect.w;
        const width = Math.abs(w) < Math.abs(h / ratio) ? w : h / ratio;
        const height = width * ratio;
        if (handle.includes('w')) {
            x = rect.x + rect.w - width;
        }
        if (handle.startsWith('n')) {
            y = rect.y + rect.h - height;
        }
        w = width;
        h = height;
    }
    return { x, y, w, h };
};

export const scaleElement = (element: DrawingElement, from: Rect, to: Rect): DrawingElement => {
    const scaleX = from.w === 0 ? 1 : to.w / from.w;
    const scaleY = from.h === 0 ? 1 : to.h / from.h;
    const placed = {
        ...element,
        x: to.x + (element.x - from.x) * scaleX,
        y: to.y + (element.y - from.y) * scaleY,
        w: element.w * scaleX,
        h: element.h * scaleY
    };
    if (placed.kind === 'line') {
        return { ...placed, points: placed.points.map(([x, y]) => [x * scaleX, y * scaleY] as [number, number]) };
    }
    if (placed.kind === 'freehand') {
        return { ...placed, points: placed.points.map(([x, y, pressure]) => [x * scaleX, y * scaleY, pressure] as [number, number, number?]) };
    }
    if (placed.kind === 'text') {
        // From here on the box is the person's, so typing no longer refits it.
        return { ...placed, sized: true };
    }
    return placed;
};

export const arrowHead = (tip: Point, from: Point, size: number): [Point, Point][] => {
    const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
    const spread = Math.PI / 7;
    return [
        [tip, { x: tip.x - size * Math.cos(angle - spread), y: tip.y - size * Math.sin(angle - spread) }],
        [tip, { x: tip.x - size * Math.cos(angle + spread), y: tip.y - size * Math.sin(angle + spread) }]
    ];
};

/* How long an arrow head is for a given stroke: heavier lines carry a bigger head. */
export const arrowHeadSize = (strokeWidth: number): number => 12 + strokeWidth * 4;
