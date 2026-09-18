import type { Edge } from '@/state/canvas';
import type { FixedSides } from '@/canvas/edge-route';
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

/*
 * Whether a line may still be drawn between these two: never onto itself, and never a second one the
 * same way round. The way back is a line of its own, since it is what makes the other end readable,
 * so a pair fills at two and a third line between the same two would only repeat a direction.
 */
export const canLink = (edges: readonly Edge[], from: string, to: string): boolean =>
    from !== to && !edges.some((edge) => edge.from === from && edge.to === to);

/*
 * The ports a line is held to. Both directions of a pair are one line, and the one drawn back names
 * the same two ports the other way round.
 */
export const fixedSides = (line: EdgeLine): FixedSides => ({
    fromSide: line.edge.fromSide ?? line.back?.toSide,
    toSide: line.edge.toSide ?? line.back?.fromSide
});

/* Whether a selection is exactly one line, which is when Enter may open its name for editing. */
export const selectedLine = (lines: readonly EdgeLine[], selection: readonly string[]): EdgeLine | null =>
    lines.find((line) => line.ids.length === selection.length && line.ids.every((id) => selection.includes(id))) ?? null;

// A text has no box of its own; this is close enough to aim an edge at.
export const textRect = (text: { x: number; y: number; size: number; text: string }): Rect => ({
    x: text.x,
    y: text.y,
    w: Math.max(40, text.text.length * text.size * 0.55),
    h: text.size * 1.4
});
