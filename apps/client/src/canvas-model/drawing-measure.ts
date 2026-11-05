import { LINE_HEIGHT, NOTE_PADDING, fontOf, linesOf, type MeasureLine, type WrittenElement } from '@adecore/drawing';
import type { DrawingFont } from '@ruimte/contracts';
import { readFontStacks } from '@/canvas-model/drawing-palette';

export function fontOfElement(element: WrittenElement, fonts: Record<DrawingFont, string>): string {
    return `${element.size}px ${fonts[fontOf(element.font)]}`;
}

let scratch: CanvasRenderingContext2D | null = null;

function scratchContext(): CanvasRenderingContext2D | null {
    if (typeof document === 'undefined') {
        return null;
    }
    scratch ??= document.createElement('canvas').getContext('2d');
    return scratch;
}

/* A line measure in the element's font, for wrapping the way the screen paints it; null without a DOM. */
export function measureLineIn(element: WrittenElement, fonts: Record<DrawingFont, string>): MeasureLine | null {
    const ctx = scratchContext();
    if (!ctx) {
        return null;
    }
    ctx.font = fontOfElement(element, fonts);
    return (line) => ctx.measureText(line).width;
}

export function linesOn(ctx: CanvasRenderingContext2D, element: WrittenElement): string[] {
    return linesOf(element, (line) => ctx.measureText(line).width);
}

function measureText(ctx: CanvasRenderingContext2D, element: WrittenElement, fonts: Record<DrawingFont, string>): { w: number; h: number } {
    ctx.save();
    ctx.font = fontOfElement(element, fonts);
    const lines = linesOn(ctx, element);
    const width = Math.max(1, ...lines.map((line) => ctx.measureText(line).width));
    ctx.restore();
    return { w: Math.ceil(width), h: Math.ceil(lines.length * element.size * LINE_HEIGHT) };
}

/*
 * The box a text takes for what it says: the glyphs' own box until the person dragged one, and
 * from then on that width, with the height the wrapped lines come to. Without a DOM the box stays.
 */
export function fitTextBox(element: WrittenElement, text = element.text): { w: number; h: number } {
    const ctx = scratchContext();
    if (!ctx) {
        return { w: element.w, h: element.h };
    }
    const fitted = measureText(ctx, { ...element, text }, readFontStacks());
    if (element.kind === 'note') {
        // A note keeps the paper it was given and grows downwards for what does not fit on it.
        return { w: element.w, h: Math.max(element.h, fitted.h + NOTE_PADDING * 2) };
    }
    return element.sized ? { w: element.w, h: fitted.h } : fitted;
}
