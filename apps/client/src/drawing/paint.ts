import type { DrawingElement, DrawingFont } from '@ruimte/contracts';
import {
    LINE_HEIGHT,
    NOTE_PADDING,
    fontOf,
    linesOf,
    pathsOfElement,
    writingFrameOf,
    type ElementPath,
    type MeasureLine,
    type WrittenElement
} from '@ruimte/drawing';
import { readEdge, readFontStacks, readPaper, readPalette, type DrawingPalette } from '@/drawing/palette';

export interface PaintOptions {
    palette: DrawingPalette;
    /* The sheets a note may be written on; without them a note is painted on its stroke color. */
    paper?: DrawingPalette;
    /* The edge of those sheets, which is the paper a step deeper into its own color. */
    edge?: DrawingPalette;
    fonts: Record<DrawingFont, string>;
    /* Elements the eraser is over: they fade before the drag lets go of them. */
    fading?: ReadonlySet<string>;
    /* The element whose words are in the editor above: its paper is painted, its text is not. */
    writing?: string | null;
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

export const fontOfElement = (element: WrittenElement, fonts: Record<DrawingFont, string>): string => `${element.size}px ${fonts[fontOf(element.font)]}`;

let scratch: CanvasRenderingContext2D | null = null;

const scratchContext = (): CanvasRenderingContext2D | null => {
    if (typeof document === 'undefined') {
        return null;
    }
    scratch ??= document.createElement('canvas').getContext('2d');
    return scratch;
};

/* The box a text needs, measured off screen: what a text element takes as its width and height. */
export const textSize = (element: WrittenElement, fonts: Record<DrawingFont, string>): { w: number; h: number } => {
    const ctx = scratchContext();
    return ctx ? measureText(ctx, element, fonts) : { w: element.w, h: element.h };
};

/* A line measure in the element's font, for wrapping the way the screen paints it; null without a DOM. */
export const measureLineIn = (element: WrittenElement, fonts: Record<DrawingFont, string>): MeasureLine | null => {
    const ctx = scratchContext();
    if (!ctx) {
        return null;
    }
    ctx.font = fontOfElement(element, fonts);
    return (line) => ctx.measureText(line).width;
};

const linesOn = (ctx: CanvasRenderingContext2D, element: WrittenElement): string[] => linesOf(element, (line) => ctx.measureText(line).width);

/* The box a text needs for the size it is set in; the caller decides what to do with it. */
export const measureText = (ctx: CanvasRenderingContext2D, element: WrittenElement, fonts: Record<DrawingFont, string>): { w: number; h: number } => {
    ctx.save();
    ctx.font = fontOfElement(element, fonts);
    const lines = linesOn(ctx, element);
    const w = Math.max(1, ...lines.map((line) => ctx.measureText(line).width));
    ctx.restore();
    return { w: Math.ceil(w), h: Math.ceil(lines.length * element.size * LINE_HEIGHT) };
};

/*
 * The box a text takes for what it says: the glyphs' own box until the person dragged one, and
 * from then on that width, with the height the wrapped lines come to. Without a DOM (the store's
 * tests) the box stays as it is.
 */
export const fitTextBox = (element: WrittenElement, text = element.text): { w: number; h: number } => {
    if (typeof document === 'undefined') {
        return { w: element.w, h: element.h };
    }
    const fitted = textSize({ ...element, text }, readFontStacks());
    if (element.kind === 'note') {
        // A note keeps the paper it was given and grows downwards for what does not fit on it.
        return { w: element.w, h: Math.max(element.h, fitted.h + NOTE_PADDING * 2) };
    }
    return element.sized ? { w: element.w, h: fitted.h } : fitted;
};

const paintText = (ctx: CanvasRenderingContext2D, element: WrittenElement, options: PaintOptions): void => {
    ctx.font = fontOfElement(element, options.fonts);
    ctx.fillStyle = options.palette[element.stroke];
    ctx.textAlign = element.align === 'center' ? 'center' : element.align === 'right' ? 'right' : 'left';
    ctx.textBaseline = 'alphabetic';
    const frame = writingFrameOf(element);
    const dx = frame.x + (element.align === 'center' ? frame.w / 2 : element.align === 'right' ? frame.w : 0);
    for (const [index, line] of linesOn(ctx, element).entries()) {
        ctx.fillText(line, dx, frame.y + (index + 0.8) * element.size * LINE_HEIGHT);
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
    // What is being typed lives in the editor above, so painting it here would show it twice.
    const written = options.writing === element.id;
    if (element.kind === 'text') {
        if (!written) {
            paintText(ctx, element, options);
        }
        ctx.restore();
        return;
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // A note is filled with its paper and edged with that paper's own darker shade, never with ink.
    const note = element.kind === 'note';
    const fills = note ? (options.paper ?? options.palette) : options.palette;
    const edges = note ? (options.edge ?? options.palette) : options.palette;
    for (const path of pathsOf(element)) {
        if (path.role === 'ink') {
            ctx.fillStyle = options.palette[element.stroke];
            ctx.fill(path.path);
            continue;
        }
        const color = path.role === 'fill' ? fills[element.fillColor ?? element.stroke] : edges[note ? (element.fillColor ?? element.stroke) : element.stroke];
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
    if (element.kind === 'note' && !written) {
        paintText(ctx, element, options);
    }
    ctx.restore();
};

export const paintElements = (ctx: CanvasRenderingContext2D, elements: readonly DrawingElement[], options: PaintOptions): void => {
    for (const element of elements) {
        paintElement(ctx, element, options);
    }
};

/* What the painter needs from the theme right now, for a caller that has no reason to know more. */
export const paintOptions = (): Pick<PaintOptions, 'palette' | 'paper' | 'edge' | 'fonts'> => ({
    palette: readPalette(),
    paper: readPaper(),
    edge: readEdge(),
    fonts: readFontStacks()
});

/*
 * Puts the camera on a context: world units in, device pixels out, so every element paints in the
 * coordinates it is stored in.
 */
export const applyCamera = (ctx: CanvasRenderingContext2D, camera: { x: number; y: number; zoom: number }, dpr: number): void => {
    ctx.setTransform(camera.zoom * dpr, 0, 0, camera.zoom * dpr, camera.x * dpr, camera.y * dpr);
};
