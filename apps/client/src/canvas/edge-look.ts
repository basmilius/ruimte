import { edgeRole, type EdgeRole, type FlowPort } from '@ruimte/contracts';
import type { EdgeLine } from '@/canvas/edge-lines';
import type { MarkerShape } from '@/canvas/marker-path';

/* Every meaning a line can have on screen, the plain one included: a line nobody gave a role. */
export type LineRole = EdgeRole | 'plain';

/* How one line is drawn: what it wears where it meets either node, and the stroke it runs in. */
export interface EdgeLook {
    /* The marker at the end the line leaves from, and the one at the end it runs into. */
    tail: MarkerShape;
    head: MarkerShape;
    dashed: boolean;
    /* A line that carries something is drawn in the context color, every other one in the neutral. */
    accent: boolean;
    /* The stroke at rest. Hovered or selected a line is drawn one step heavier than this. */
    width: number;
}

/* What the canvas has always drawn a line with, and what every line but an origin still gets. */
export const EDGE_WIDTH = 2;

/* An origin line only says where a node came from and grants nothing, so it lies under the rest.
   A whole pixel and not half of one: 2 is already the thin stroke, and 1.5 blurs at rest. */
const ORIGIN_WIDTH = 1;

/*
 * What a line means. The role written on it decides, from either direction of a pair, since a person
 * sees one line. A line without a role, or with a word a newer Ruimte wrote, is read the way every
 * line was read before the field existed: running into an agent it is the context that agent reads,
 * the way back of a pair included, since a line drawn both ways says the reading out loud. A line
 * out of an agent into something that never reads carries that same context back, and into a device
 * or a page it says the agent works there, which is what a target line is for.
 */
export const lineRole = (line: EdgeLine, reads: (nodeId: string) => boolean, driven: (nodeId: string) => boolean): LineRole => {
    const written = edgeRole(line.edge) ?? (line.back === null ? null : edgeRole(line.back));
    if (written !== null) {
        return written;
    }
    if (reads(line.edge.to) || (line.back !== null && reads(line.back.to))) {
        return 'context';
    }
    if (!reads(line.edge.from)) {
        return 'plain';
    }
    return driven(line.edge.to) ? 'target' : 'context';
};

/*
 * The table of what each kind of line wears. An open task comes before the role: the line under it
 * is a context line the whole time, and only says the task is still out while it is.
 */
export const edgeLook = (role: LineRole, { pair, openTask }: { pair: boolean; openTask: boolean }): EdgeLook => {
    if (openTask) {
        return { tail: 'none', head: 'dot', dashed: true, accent: true, width: EDGE_WIDTH };
    }
    switch (role) {
        case 'context':
            return { tail: pair ? 'dot' : 'none', head: 'dot', dashed: false, accent: true, width: EDGE_WIDTH };
        case 'target':
            return { tail: 'none', head: 'chevron', dashed: false, accent: false, width: EDGE_WIDTH };
        case 'origin':
            return { tail: 'dot', head: 'arrow', dashed: true, accent: false, width: ORIGIN_WIDTH };
        case 'plain':
            return { tail: 'dot', head: 'dot', dashed: false, accent: false, width: EDGE_WIDTH };
    }
};

/*
 * The second table of the same kind, for a line leaving a flow card. The way a run carries on is
 * drawn through and in the context color, the way out it takes when something is false or went wrong
 * is dashed and neutral, so a worksheet reads in a screenshot and for anyone who reads color poorly.
 * A dot closes the line off at the port it leaves, a chevron points into the card that runs next.
 */
export const flowLook = (port: FlowPort): EdgeLook => {
    switch (port) {
        case 'done':
        case 'true':
            return { tail: 'dot', head: 'chevron', dashed: false, accent: true, width: EDGE_WIDTH };
        case 'error':
        case 'false':
            return { tail: 'dot', head: 'chevron', dashed: true, accent: false, width: EDGE_WIDTH };
    }
};

/*
 * The color one line runs in. A line that carries something runs in the context color and every
 * other one in the neutral; active, which is pointed at or picked, is the livelier of the two.
 */
export const edgeStroke = (look: EdgeLook, active: boolean): string => {
    if (look.accent) {
        return active ? 'var(--accent)' : 'var(--edge-context)';
    }
    return active ? 'var(--text-muted)' : 'var(--edge-line)';
};
