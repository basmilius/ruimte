import type { StoreApi } from 'zustand';
import type { DrawingElement } from '@ruimte/contracts';
import { DEFAULT_SVG_MARGIN, approximateMeasure, boundsOfElements, toSvg } from '@ruimte/drawing';
import { desktop } from '@/desktop/bridge';
import { measureLineIn, paintElements, paintOptions } from '@/drawing/paint';
import { readCanvasBackground, readFontStacks, readPaper, readPalette } from '@/drawing/palette';
import type { DrawingState } from '@/state/drawing';

/* A PNG is written at twice the size, so it still reads when it is dropped into a document. */
const PNG_SCALE = 2;

/* What the clipboard carries between two drawings of this app; anything else pastes as nothing. */
export const CLIPBOARD_TYPE = 'application/x-ruimte-drawing';

/*
 * Which drawing an export is about. Every one of these takes the store rather than reaching for the
 * focused one: the dock that offers them is drawn inside a cell, and in a split that cell is not
 * always the one with the focus.
 */
type DrawingSource = StoreApi<DrawingState>;

/* The selection if there is one, else the whole drawing: what every export acts on. */
export const exportTargets = (store: DrawingSource): DrawingElement[] => {
    const { elements, selection } = store.getState();
    const selected = elements.filter((element) => selection.includes(element.id));
    return selected.length > 0 ? selected : elements;
};

export const drawingSvg = (store: DrawingSource, elements: readonly DrawingElement[] = exportTargets(store)): string =>
    toSvg(elements, {
        palette: readPalette(),
        paper: readPaper(),
        background: store.getState().exportBackground ? readCanvasBackground() : null,
        // Wrapped where the screen wraps, so the file shows the lines the person saw.
        measure: (element) => measureLineIn(element, readFontStacks()) ?? approximateMeasure(element.size, element.font)
    });

/* The same painter the screen uses, on a canvas of its own, at the size the file is written in. */
export const drawingPng = async (store: DrawingSource, elements: readonly DrawingElement[] = exportTargets(store)): Promise<Blob | null> => {
    const bounds = boundsOfElements(elements);
    if (!bounds) {
        return null;
    }
    const width = Math.ceil((bounds.w + DEFAULT_SVG_MARGIN * 2) * PNG_SCALE);
    const height = Math.ceil((bounds.h + DEFAULT_SVG_MARGIN * 2) * PNG_SCALE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return null;
    }
    if (store.getState().exportBackground) {
        ctx.fillStyle = readCanvasBackground();
        ctx.fillRect(0, 0, width, height);
    }
    ctx.setTransform(PNG_SCALE, 0, 0, PNG_SCALE, (DEFAULT_SVG_MARGIN - bounds.x) * PNG_SCALE, (DEFAULT_SVG_MARGIN - bounds.y) * PNG_SCALE);
    paintElements(ctx, elements, paintOptions());
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
};

export const download = async (blob: Blob, name: string, mime: string): Promise<void> => {
    const bridge = desktop();
    if (bridge?.saveFile) {
        // The desktop app asks where the file goes; a browser tab has no such dialog to offer.
        await bridge.saveFile(name, new Uint8Array(await blob.arrayBuffer()), mime);
        return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
};

/* Where an export lands unless the person names it otherwise: what it is and the day it was made. */
export const exportFileName = (prefix: string, extension: string): string => `${prefix}-${new Date().toISOString().slice(0, 10)}.${extension}`;

/* Elements as the clipboard carries them, so a paste in another drawing brings the shapes, not a picture. */
export const drawingClipboardText = (elements: readonly DrawingElement[]): string => JSON.stringify({ type: CLIPBOARD_TYPE, elements });

/* What a paste finds on the clipboard, or null when it is not a drawing of ours. */
export const readDrawingElements = (text: string): DrawingElement[] | null => {
    try {
        const value = JSON.parse(text) as { type?: string; elements?: DrawingElement[] };
        return value.type === CLIPBOARD_TYPE && Array.isArray(value.elements) ? value.elements : null;
    } catch {
        return null;
    }
};
