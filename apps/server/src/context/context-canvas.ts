import { escapeXml } from '@adecore/drawing';
import { groupMemberIds, type ProjectCanvasView, type ProjectNode } from '@ruimte/contracts';

function firstLine(text: string): string {
    return text.split('\n')[0]?.trim().slice(0, 80) ?? '';
}

function nodeLine(node: ProjectNode): string {
    return `- ${node.id} ${node.kind} ${JSON.stringify(node.title)} at ${Math.round(node.x)},${Math.round(node.y)}, ${Math.round(node.w)}x${Math.round(node.h)}`;
}

/*
 * What stands on a canvas, for an agent that was pointed at the whole of it: every node, what each
 * group frames, every text and every line. It says where things are, never what a node holds; each
 * id reads on its own.
 */
export function renderCanvas(canvas: ProjectCanvasView): string {
    const items = [...canvas.nodes, ...canvas.texts];
    const groups = canvas.nodes.filter((node) => node.kind === 'group');
    const nodes = canvas.nodes.filter((node) => node.kind !== 'group');
    const lines = [`# Canvas ${JSON.stringify(canvas.name)}`, '', '## Nodes', ''];
    lines.push(...(nodes.length === 0 ? ['None.'] : nodes.map(nodeLine)));
    if (groups.length > 0) {
        lines.push('', '## Groups', '');
        for (const group of groups) {
            const members = groupMemberIds(group, items).filter((id) => id !== group.id);
            lines.push(`${nodeLine(group)}: ${members.length === 0 ? 'empty' : members.join(', ')}`);
        }
    }
    if (canvas.texts.length > 0) {
        lines.push('', '## Texts', '');
        lines.push(...canvas.texts.map((text) => `- ${text.id} ${JSON.stringify(firstLine(text.text))} at ${Math.round(text.x)},${Math.round(text.y)}`));
    }
    lines.push('', '## Lines', '');
    lines.push(
        ...(canvas.edges.length === 0
            ? ['None.']
            : canvas.edges.map(
                  (edge) => `- ${edge.from} -> ${edge.to}${edge.label === undefined || edge.label === '' ? '' : ` ${JSON.stringify(edge.label)}`}`
              ))
    );
    return lines.join('\n');
}

const MARGIN = 32;
const TEXT_SIZE = 14;

interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

function boundsOf(boxes: readonly Box[]): Box {
    if (boxes.length === 0) {
        return { x: 0, y: 0, w: 1, h: 1 };
    }
    const left = Math.min(...boxes.map((box) => box.x));
    const top = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map((box) => box.x + box.w));
    const bottom = Math.max(...boxes.map((box) => box.y + box.h));
    return { x: left, y: top, w: right - left, h: bottom - top };
}

function centerOf(box: Box): { x: number; y: number } {
    return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/* A text on the canvas takes about this much room; the picture only has to place it, not set it. */
function textBox(text: ProjectCanvasView['texts'][number]): Box {
    const words = firstLine(text.text);
    return { x: text.x, y: text.y, w: Math.max(words.length, 1) * text.size * 0.55, h: text.size * 1.3 };
}

/*
 * The arrangement of a canvas as an SVG: a box per node with its title and kind, a dashed frame per
 * group, the texts where they stand and the lines between centers. It shows where things are, not what
 * a terminal or a page shows, which nothing on the daemon can draw.
 */
export function canvasSvg(canvas: ProjectCanvasView): string {
    const boxes = new Map<string, Box>([
        ...canvas.nodes.map((node) => [node.id, node] as const),
        ...canvas.texts.map((text) => [text.id, textBox(text)] as const)
    ]);
    const bounds = boundsOf([...boxes.values()]);
    const x = Math.round(bounds.x - MARGIN);
    const y = Math.round(bounds.y - MARGIN);
    const w = Math.round(bounds.w + MARGIN * 2);
    const h = Math.round(bounds.h + MARGIN * 2);
    const parts: string[] = [`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>`];
    for (const node of canvas.nodes.filter((candidate) => candidate.kind === 'group')) {
        parts.push(
            `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="12" fill="none" stroke="#8a8f98" stroke-width="2" stroke-dasharray="8 6"/>`,
            `<text x="${node.x + 12}" y="${node.y + 22}" font-size="${TEXT_SIZE}" font-weight="600" fill="#3c4048">${escapeXml(node.title)}</text>`
        );
    }
    for (const edge of canvas.edges) {
        const from = boxes.get(edge.from);
        const to = boxes.get(edge.to);
        if (from === undefined || to === undefined) {
            continue;
        }
        const start = centerOf(from);
        const end = centerOf(to);
        parts.push(`<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="#5b6270" stroke-width="2" marker-end="url(#head)"/>`);
    }
    for (const node of canvas.nodes.filter((candidate) => candidate.kind !== 'group')) {
        parts.push(
            `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="10" fill="#f4f5f7" stroke="#5b6270" stroke-width="2"/>`,
            `<text x="${node.x + 12}" y="${node.y + 24}" font-size="${TEXT_SIZE}" font-weight="600" fill="#1f2328">${escapeXml(node.title)}</text>`,
            `<text x="${node.x + 12}" y="${node.y + 44}" font-size="12" fill="#5b6270">${node.kind}</text>`
        );
    }
    for (const text of canvas.texts) {
        parts.push(`<text x="${text.x}" y="${text.y + text.size}" font-size="${text.size}" fill="#1f2328">${escapeXml(firstLine(text.text))}</text>`);
    }
    const head =
        '<defs><marker id="head" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#5b6270"/></marker></defs>';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}" font-family="sans-serif">${head}${parts.join('')}</svg>`;
}
