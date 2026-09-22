import { edgeRole, type EdgeRole } from '@ruimte/contracts';
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
const EDGE_WIDTH = 2;

/* An origin line only says where a node came from and grants nothing, so it lies under the rest.
   A whole pixel and not half of one: 2 is already the thin stroke, and 1.5 blurs at rest. */
const ORIGIN_WIDTH = 1;

/* What a line means and which way it is drawn, since a person draws a pair of meanings both ways. */
export interface LineMeaning {
    role: LineRole;
    /* Whether the head belongs at the tail end: a target line drawn from the page into the agent. */
    reversed: boolean;
}

/*
 * What a line means. The role written on it decides, from either direction of a pair, since a person
 * sees one line. A line without a role, or with a word a newer Ruimte wrote, is read the way every
 * line was read before the field existed: running into an agent it is the context that agent reads,
 * the way back of a pair included, since a line drawn both ways says the reading out loud. A line
 * between an agent and a device or a page is the one case where the direction says nothing: the
 * agent both reads that node and works in it, whichever way the line was drawn, so it is a target
 * line either way and its head stays at the node being worked on.
 */
const roleOf = (line: EdgeLine, reads: (nodeId: string) => boolean, driven: (nodeId: string) => boolean): LineRole => {
    const written = edgeRole(line.edge) ?? (line.back === null ? null : edgeRole(line.back));
    if (written !== null) {
        return written;
    }
    if ((reads(line.edge.from) && driven(line.edge.to)) || (reads(line.edge.to) && driven(line.edge.from))) {
        return 'target';
    }
    if (reads(line.edge.to) || (line.back !== null && reads(line.back.to))) {
        return 'context';
    }
    return reads(line.edge.from) ? 'context' : 'plain';
};

export const lineMeaning = (line: EdgeLine, reads: (nodeId: string) => boolean, driven: (nodeId: string) => boolean): LineMeaning => {
    const role = roleOf(line, reads, driven);
    // The work happens at the end that is driven, so that is where the point of a target line goes.
    return { role, reversed: role === 'target' && driven(line.edge.from) && !driven(line.edge.to) };
};

/*
 * The table of what each kind of line wears. An open task comes before the role: the line under it
 * is a context line the whole time, and only says the task is still out while it is.
 */
const lookOf = (role: LineRole, pair: boolean, openTask: boolean): EdgeLook => {
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

export const edgeLook = (meaning: LineMeaning, { pair, openTask }: { pair: boolean; openTask: boolean }): EdgeLook => {
    const look = lookOf(meaning.role, pair, openTask);
    return meaning.reversed ? { ...look, tail: look.head, head: look.tail } : look;
};
