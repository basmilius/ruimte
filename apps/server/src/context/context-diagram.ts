import type { DiagramDocument } from '@ruimte/contracts';
import { readingOrder, toSvg } from '@ruimte/diagram';

/*
 * A diagram as an agent reads it, in the shape of a drawing's: the reading order first and the SVG
 * behind a heading of its own. A `tail` counts the reading order alone, since the last lines of an
 * SVG are markup and not an answer.
 */
export const renderDiagram = (document: DiagramDocument, tail: number | null = null): string => {
    const lines = readingOrder(document);
    const list = lines.length > 0 ? lines : ['This diagram has no nodes in it.'];
    if (tail !== null) {
        return list.slice(Math.max(0, list.length - tail)).join('\n');
    }
    const title = document.meta.title.trim();
    return [title === '' ? '# Diagram' : `# Diagram: ${title}`, '', list.join('\n'), '', '## SVG', '', toSvg(document, { background: null })].join('\n');
};
