import type { LayoutMetrics } from './layout.ts';

export interface EditorFont {
    family: string;
    /* In pixels. */
    size: number;
    lineHeight: number;
}

const FALLBACK: EditorFont = { family: 'monospace', size: 13, lineHeight: 20 };

function pixels(value: string): number | null {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/* The code face the page gives the editor's element, in whole pixels so a line is as tall as the viewer's. */
export function readEditorFont(element: HTMLElement): EditorFont {
    const view = element.ownerDocument.defaultView;
    if (!view?.getComputedStyle) {
        return FALLBACK;
    }
    const style = view.getComputedStyle(element);
    const size = pixels(style.fontSize) ?? FALLBACK.size;
    const lineHeight = pixels(style.lineHeight) ?? Math.round(size * 1.5);
    return { family: style.fontFamily || FALLBACK.family, size, lineHeight: Math.round(lineHeight) };
}

/* Character widths from a canvas, which sets the text in the same face the page draws it in. Without a canvas a character is 0.6 of the size. */
export function createMetrics(font: EditorFont, tabSize: number, document: Document): LayoutMetrics {
    let context: CanvasRenderingContext2D | null = null;
    try {
        context = document.createElement('canvas').getContext('2d');
    } catch {
        context = null;
    }
    const codeFont = `${font.size}px ${font.family}`;
    const inlayFont = `${Math.max(12, font.size - 1)}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    const cache = new Map<string, number>();
    const measure = (text: string, face: string, fallback: number): number => {
        if (!context) {
            return Array.from(text).length * fallback;
        }
        context.font = face;
        context.fontKerning = 'none';
        return context.measureText(text).width;
    };
    return {
        lineHeight: font.lineHeight,
        charWidth: measure('M', codeFont, font.size * 0.6),
        tabSize,
        measureText(text) {
            let width = cache.get(text);
            if (width === undefined) {
                width = measure(text, codeFont, font.size * 0.6);
                if (cache.size > 2000) {
                    cache.clear();
                }
                cache.set(text, width);
            }
            return width;
        },
        measureInlay: (text) => measure(text, inlayFont, font.size * 0.5)
    };
}
