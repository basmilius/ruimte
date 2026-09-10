import type { DrawingElement } from '@ruimte/contracts';
import { DEFAULT_PALETTE, readingOrder, toSvg } from '@ruimte/drawing';

/*
 * A drawing as an agent reads it: the texts in reading order with the arrows between them, and the
 * picture itself after them. The SVG sits behind a heading of its own, so an agent that only wants
 * to know what the drawing says can stop at the list.
 */
export const renderDrawing = (elements: readonly DrawingElement[]): string => {
    const lines = readingOrder(elements);
    const list = lines.length > 0 ? lines.join('\n') : 'This drawing has no text in it.';
    return [`# Drawing`, '', list, '', '## SVG', '', toSvg(elements, { palette: DEFAULT_PALETTE, background: null })].join('\n');
};
