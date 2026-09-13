import type { DrawingElement } from '@ruimte/contracts';
import { DEFAULT_PALETTE, readingOrder, toSvg } from '@ruimte/drawing';

/*
 * A drawing as an agent reads it: the texts in reading order with the arrows between them, and the
 * picture itself after them. The SVG sits behind a heading of its own, so an agent that only wants
 * to know what the drawing says can stop at the list. A `tail` asks for the cheap read and gets the
 * last lines of the reading order alone: the picture is the expensive half, and the last lines of an
 * SVG are markup, not an answer.
 */
export const renderDrawing = (elements: readonly DrawingElement[], tail: number | null = null): string => {
    const lines = readingOrder(elements);
    const list = lines.length > 0 ? lines : ['This drawing has no text in it.'];
    if (tail !== null) {
        return list.slice(Math.max(0, list.length - tail)).join('\n');
    }
    return [`# Drawing`, '', list.join('\n'), '', '## SVG', '', toSvg(elements, { palette: DEFAULT_PALETTE, background: null })].join('\n');
};
