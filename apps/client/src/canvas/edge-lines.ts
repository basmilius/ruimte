import type { Edge } from '@/state/canvas';
import type { Rect } from '@/canvas/math';

/*
 * One line on the canvas. Two agents that read each other are two edges, one each way, because the
 * direction is real information the daemon reads. On screen they are one line with a head at both
 * ends: two beziers between the same pair of nodes take the same path and lie on top of each other,
 * which reads as one line drawn badly rather than as two directions.
 */
export interface EdgeLine {
    /* The edge the line is drawn from; its `from` is the tail and its `to` the head. */
    edge: Edge;
    /* The edge running back between the same two nodes, when there is one. */
    back: Edge | null;
    /* Every edge this one line stands for: what a click selects and what a delete takes away. */
    ids: string[];
    /* What the line is called; the first name of the pair, since a person names the line and not a direction. */
    label: string | undefined;
}

/* The lines to draw for a set of edges, in the order the edges came, a pair folded into one. */
export const edgeLines = (edges: readonly Edge[]): EdgeLine[] => {
    const lines: EdgeLine[] = [];
    const paired = new Set<string>();
    for (const edge of edges) {
        if (paired.has(edge.id)) {
            continue;
        }
        paired.add(edge.id);
        const back = edges.find((other) => !paired.has(other.id) && other.from === edge.to && other.to === edge.from && other.from !== other.to) ?? null;
        if (back) {
            paired.add(back.id);
        }
        lines.push({
            edge,
            back,
            ids: back === null ? [edge.id] : [edge.id, back.id],
            label: edge.label ?? back?.label
        });
    }
    return lines;
};

/* Whether a selection is exactly one line, which is when Enter may open its name for editing. */
export const selectedLine = (lines: readonly EdgeLine[], selection: readonly string[]): EdgeLine | null =>
    lines.find((line) => line.ids.length === selection.length && line.ids.every((id) => selection.includes(id))) ?? null;

export interface Anchors {
    ax: number;
    ay: number;
    bx: number;
    by: number;
    horizontal: boolean;
}

/* Anchor on the facing sides, so an edge takes the short way round. */
export const anchors = (a: Rect, b: Rect): Anchors => {
    const acx = a.x + a.w / 2;
    const acy = a.y + a.h / 2;
    const bcx = b.x + b.w / 2;
    const bcy = b.y + b.h / 2;
    const horizontal = Math.abs(bcx - acx) >= Math.abs(bcy - acy);
    if (horizontal) {
        const right = bcx >= acx;
        return { ax: right ? a.x + a.w : a.x, ay: acy, bx: right ? b.x : b.x + b.w, by: bcy, horizontal };
    }
    const below = bcy >= acy;
    return { ax: acx, ay: below ? a.y + a.h : a.y, bx: bcx, by: below ? b.y : b.y + b.h, horizontal };
};

export const curve = (p: Anchors): string =>
    p.horizontal
        ? `M ${p.ax} ${p.ay} C ${(p.ax + p.bx) / 2} ${p.ay}, ${(p.ax + p.bx) / 2} ${p.by}, ${p.bx} ${p.by}`
        : `M ${p.ax} ${p.ay} C ${p.ax} ${(p.ay + p.by) / 2}, ${p.bx} ${(p.ay + p.by) / 2}, ${p.bx} ${p.by}`;

// A text has no box of its own; this is close enough to aim an edge at.
export const textRect = (text: { x: number; y: number; size: number; text: string }): Rect => ({
    x: text.x,
    y: text.y,
    w: Math.max(40, text.text.length * text.size * 0.55),
    h: text.size * 1.4
});
