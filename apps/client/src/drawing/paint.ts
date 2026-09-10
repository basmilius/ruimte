import type { DrawingElement, DrawingFont } from '@ruimte/contracts';
import { LINE_HEIGHT, fontOf, pathsOfElement, textLines, type ElementPath } from '@ruimte/drawing';
import type { DrawingPalette } from '@/drawing/palette';

export interface PaintOptions {
    palette: DrawingPalette;
    fonts: Record<DrawingFont, string>;
    /* Elements the eraser is over: they fade before the drag lets go of them. */
    fading?: ReadonlySet<string>;
}

/* How faint an element goes while the eraser is on it. */
const FADED = 0.3;

interface CachedPaths {
    key: string;
    paths: Array<ElementPath & { path: Path2D }>;
}

/*
 * Everything about an element that changes the shape of its paths. Moving it does not: the paths
 * are drawn in the element's own frame, so a drag repaints without asking rough for anything.
 */
const shapeKey = (element: DrawingElement): string =>
    JSON.stringify([
        element.kind,
        Math.round(element.w),
        Math.round(element.h),
        element.seed,
        element.strokeWidth,
        element.strokeStyle,
        element.roughness,
        element.fill,
        'radius' in element ? element.radius : null,
        'points' in element ? element.points.length : 0,
        'points' in element ? element.points.at(-1) : null,
        'arrowStart' in element ? element.arrowStart : null,
        'arrowEnd' in element ? element.arrowEnd : null
    ]);

const cache = new Map<string, CachedPaths>();

/* The paths of an element, made once per shape. Rough is deterministic per seed, so this is safe. */
const pathsOf = (element: DrawingElement): CachedPaths['paths'] => {
    const key = shapeKey(element);
    const known = cache.get(element.id);
    if (known && known.key === key) {
        return known.paths;
    }
    const paths = pathsOfElement(element).map((path) => ({ ...path, path: new Path2D(path.d) }));
    cache.set(element.id, { key, paths });
    return paths;
};

/* Frees what a drawing left behind; called when another one is loaded. */
export const clearPathCache = (): void => cache.clear();

export const fontOfElement = (element: DrawingElement & { kind: 'text' }, fonts: Record<DrawingFont, string>): string =>
    `${element.size}px ${fonts[fontOf(element.font)]}`;

let scratch: CanvasRenderingContext2D | null = null;

/* The box a text needs, measured off screen: what a text element takes as its width and height. */
export const textSize = (element: DrawingElement & { kind: 'text' }, fonts: Record<DrawingFont, string>): { w: number; h: number } => {
    scratch ??= document.createElement('canvas').getContext('2d');
    return scratch ? measureText(scratch, element, fonts) : { w: element.w, h: element.h };
};

/* The box a text needs for the size it is set in; the caller decides what to do with it. */
export const measureText = (
    ctx: CanvasRenderingContext2D,
    element: DrawingElement & { kind: 'text' },
    fonts: Record<DrawingFont, string>
): { w: number; h: number } => {
    ctx.save();
    ctx.font = fontOfElement(element, fonts);
    const lines = textLines(element.text);
    const w = Math.max(1, ...lines.map((line) => ctx.measureText(line).width));
    ctx.restore();
    return { w: Math.ceil(w), h: Math.ceil(lines.length * element.size * LINE_HEIGHT) };
};

const paintText = (ctx: CanvasRenderingContext2D, element: DrawingElement & { kind: 'text' }, options: PaintOptions): void => {
    ctx.font = fontOfElement(element, options.fonts);
    ctx.fillStyle = options.palette[element.stroke];
    ctx.textAlign = element.align === 'center' ? 'center' : element.align === 'right' ? 'right' : 'left';
    ctx.textBaseline = 'alphabetic';
    const dx = element.align === 'center' ? element.w / 2 : element.align === 'right' ? element.w : 0;
    for (const [index, line] of textLines(element.text).entries()) {
        ctx.fillText(line, dx, (index + 0.8) * element.size * LINE_HEIGHT);
    }
};

export const paintElement = (ctx: CanvasRenderingContext2D, element: DrawingElement, options: PaintOptions): void => {
    ctx.save();
    ctx.globalAlpha = options.fading?.has(element.id) ? FADED : 1;
    ctx.translate(element.x, element.y);
    if (element.angle) {
        ctx.translate(element.w / 2, element.h / 2);
        ctx.rotate(element.angle);
        ctx.translate(-element.w / 2, -element.h / 2);
    }
    if (element.kind === 'text') {
        paintText(ctx, element, options);
        ctx.restore();
        return;
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const path of pathsOf(element)) {
        if (path.role === 'ink') {
            ctx.fillStyle = options.palette[element.stroke];
            ctx.fill(path.path);
            continue;
        }
        const color = path.role === 'fill' ? options.palette[element.fillColor ?? element.stroke] : options.palette[element.stroke];
        // A hachure fill arrives as a bundle of thin lines, so it is stroked rather than filled.
        if (path.role === 'fill' && element.fill !== 'hachure') {
            ctx.fillStyle = color;
            ctx.fill(path.path);
            continue;
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = path.strokeWidth;
        ctx.setLineDash(path.dash ?? []);
        ctx.stroke(path.path);
        ctx.setLineDash([]);
    }
    ctx.restore();
};

export const paintElements = (ctx: CanvasRenderingContext2D, elements: readonly DrawingElement[], options: PaintOptions): void => {
    for (const element of elements) {
        paintElement(ctx, element, options);
    }
};

/*
 * Puts the camera on a context: world units in, device pixels out, so every element paints in the
 * coordinates it is stored in.
 */
export const applyCamera = (ctx: CanvasRenderingContext2D, camera: { x: number; y: number; zoom: number }, dpr: number): void => {
    ctx.setTransform(camera.zoom * dpr, 0, 0, camera.zoom * dpr, camera.x * dpr, camera.y * dpr);
};
