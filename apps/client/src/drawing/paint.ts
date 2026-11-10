import { LINE_HEIGHT, pathsOfElement, writingFrameOf, type ElementPath, type WrittenElement } from '@adecore/drawing';
import type { DrawingElement, DrawingFont } from '@ruimte/contracts';
import { fontOfElement, linesOn } from '@/canvas-model/drawing-measure';
import { readEdge, readFontStacks, readPalette, readPaper, type DrawingPalette } from '@/canvas-model/drawing-palette';

interface PaintOptions {
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

const FADED = 0.3;

interface CachedPaths {
    key: string;
    paths: Array<ElementPath & { path: Path2D }>;
}

/*
 * Everything about an element that changes the shape of its paths. Moving it does not: the paths
 * are drawn in the element's own frame, so a drag repaints without asking rough for anything.
 */
function shapeKey(element: DrawingElement): string {
    return JSON.stringify([
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
}

const cache = new Map<string, CachedPaths>();

/* The paths of an element, made once per shape. Rough is deterministic per seed, so this is safe. */
function pathsOf(element: DrawingElement): CachedPaths['paths'] {
    const key = shapeKey(element);
    const known = cache.get(element.id);
    if (known && known.key === key) {
        return known.paths;
    }
    const paths = pathsOfElement(element).map((path) => ({ ...path, path: new Path2D(path.d) }));
    cache.set(element.id, { key, paths });
    return paths;
}

/* Frees what a drawing left behind; called when another one is loaded. */
export function clearPathCache(): void {
    cache.clear();
}

function paintText(ctx: CanvasRenderingContext2D, element: WrittenElement, options: PaintOptions): void {
    ctx.font = fontOfElement(element, options.fonts);
    ctx.fillStyle = options.palette[element.stroke];
    ctx.textAlign = element.align ?? 'left';
    ctx.textBaseline = 'alphabetic';
    const frame = writingFrameOf(element);
    const dx = frame.x + (element.align === 'center' ? frame.w / 2 : element.align === 'right' ? frame.w : 0);
    for (const [index, line] of linesOn(ctx, element).entries()) {
        ctx.fillText(line, dx, frame.y + (index + 0.8) * element.size * LINE_HEIGHT);
    }
}

function paintElement(ctx: CanvasRenderingContext2D, element: DrawingElement, options: PaintOptions): void {
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
}

export function paintElements(ctx: CanvasRenderingContext2D, elements: readonly DrawingElement[], options: PaintOptions): void {
    for (const element of elements) {
        paintElement(ctx, element, options);
    }
}

export function paintOptions(): Pick<PaintOptions, 'palette' | 'paper' | 'edge' | 'fonts'> {
    return {
        palette: readPalette(),
        paper: readPaper(),
        edge: readEdge(),
        fonts: readFontStacks()
    };
}

/*
 * Puts the camera on a context: world units in, device pixels out, so every element paints in the
 * coordinates it is stored in.
 */
export function applyCamera(ctx: CanvasRenderingContext2D, camera: { x: number; y: number; zoom: number }, dpr: number): void {
    ctx.setTransform(camera.zoom * dpr, 0, 0, camera.zoom * dpr, camera.x * dpr, camera.y * dpr);
}
