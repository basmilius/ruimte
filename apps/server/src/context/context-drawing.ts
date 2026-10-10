import type { DrawingElement } from '@ruimte/contracts';
import { DEFAULT_PALETTE, readingOrder, toSvg } from '@adecore/drawing';

/*
 * A drawing as an agent reads it: the texts in reading order with the arrows between them, then the
 * SVG under a heading of its own. A `tail` counts the reading order alone, since the last lines of an
 * SVG are markup and not an answer.
 */
export function renderDrawing(elements: readonly DrawingElement[], tail: number | null = null): string {
    const lines = readingOrder(elements);
    const list = lines.length > 0 ? lines : ['This drawing has no text in it.'];
    if (tail !== null) {
        return list.slice(Math.max(0, list.length - tail)).join('\n');
    }
    return [`# Drawing`, '', list.join('\n'), '', '## SVG', '', toSvg(elements, { palette: DEFAULT_PALETTE, background: null })].join('\n');
}
