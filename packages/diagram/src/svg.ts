import type { DiagramDocument, DrawingColor } from '@ruimte/contracts';
import { DEFAULT_FONT_STACKS, DEFAULT_PALETTE, DEFAULT_PAPER } from '@ruimte/drawing';
import { GROUP_LABEL_BAND, layoutOf, type DiagramLayout } from './layout.ts';
import { arrowHeadPath, dashOf, edgeLabelLinesOf, edgePath, shapePaths, textLinesOf } from './shapes.ts';
import { SUB_SIZE } from './text.ts';

export interface DiagramSvgOptions {
    /* What every palette name is in the theme this export is made in. */
    palette?: Record<DrawingColor, string>;
    /* The pale fill behind a node of each tone. */
    paper?: Record<DrawingColor, string>;
    /* The page behind the diagram, or null for a transparent one; edge labels are haloed in it. */
    background?: string | null;
    /* World units around the diagram, so nothing touches the edge. */
    margin?: number;
    font?: string;
    /* A layout already computed for this document, so a caller that drew it does not compute it twice. */
    layout?: DiagramLayout;
}

export const DEFAULT_DIAGRAM_MARGIN = 32;

/* What a node, a group and an edge wear when the file names no tone. */
export const DEFAULT_NODE_TONE: DrawingColor = 'ink';
export const DEFAULT_GROUP_TONE: DrawingColor = 'muted';
export const DEFAULT_EDGE_TONE: DrawingColor = 'muted';

const escapeXml = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/*
 * The whole diagram as one SVG string, for an export and for what the daemon hands an agent. The
 * view in the app draws the same layout and the same paths as elements of its own, so the two only
 * differ in where the colors come from.
 */
export const toSvg = (document: Pick<DiagramDocument, 'meta' | 'nodes' | 'groups' | 'edges'>, options: DiagramSvgOptions = {}): string => {
    const palette = options.palette ?? DEFAULT_PALETTE;
    const paper = options.paper ?? DEFAULT_PAPER;
    const margin = options.margin ?? DEFAULT_DIAGRAM_MARGIN;
    const font = escapeXml(options.font ?? DEFAULT_FONT_STACKS.sans);
    const layout = options.layout ?? layoutOf(document);
    const nodes = new Map(document.nodes.map((node) => [node.id, node]));
    const groups = new Map(document.groups.map((group) => [group.id, group]));

    const x = layout.bounds.x - margin;
    const y = layout.bounds.y - margin;
    const w = layout.bounds.w + margin * 2;
    const h = layout.bounds.h + margin * 2;
    const parts: string[] = [];
    if (options.background) {
        parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${options.background}"/>`);
    }

    for (const box of layout.groups) {
        const group = groups.get(box.id)!;
        const tone = palette[group.tone ?? DEFAULT_GROUP_TONE];
        parts.push(
            `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="12" fill="none" stroke="${tone}" stroke-width="1" stroke-dasharray="6 4"/>`,
            `<text x="${box.labelBox.x}" y="${box.y + Math.round(GROUP_LABEL_BAND * 0.7)}" font-size="${SUB_SIZE}" font-weight="600" fill="${tone}">${escapeXml(group.label)}</text>`
        );
    }

    for (const route of layout.edges) {
        const edge = document.edges[route.index]!;
        const tone = palette[edge.tone ?? DEFAULT_EDGE_TONE];
        const dash = dashOf(edge.style);
        parts.push(
            `<path d="${edgePath(route.points)}" fill="none" stroke="${tone}" stroke-width="2" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`,
            `<path d="${arrowHeadPath(route.points)}" fill="${tone}"/>`
        );
        if (route.label) {
            const halo = options.background ? ` stroke="${options.background}" stroke-width="4" paint-order="stroke"` : '';
            for (const line of edgeLabelLinesOf(route.label)) {
                parts.push(
                    `<text x="${line.x}" y="${line.y}" font-size="${line.size}" text-anchor="middle" fill="${tone}"${halo}>${escapeXml(line.text)}</text>`
                );
            }
        }
    }

    for (const box of layout.nodes) {
        const node = nodes.get(box.id)!;
        const tone = node.tone ?? DEFAULT_NODE_TONE;
        const paths = shapePaths(node.shape, box);
        parts.push(`<path d="${paths.body}" fill="${paper[tone]}" stroke="${palette[tone]}" stroke-width="2"/>`);
        if (paths.detail) {
            parts.push(`<path d="${paths.detail}" fill="none" stroke="${palette[tone]}" stroke-width="2"/>`);
        }
        for (const line of textLinesOf(box, node.shape)) {
            parts.push(
                `<text x="${line.x}" y="${line.y}" font-size="${line.size}"${line.bold ? ' font-weight="600"' : ''} text-anchor="middle" fill="${line.muted ? palette.muted : palette.ink}">${escapeXml(line.text)}</text>`
            );
        }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}" font-family="${font}">${parts.join('')}</svg>`;
};
