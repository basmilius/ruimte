import { edgeRole, type EdgeRole } from '@ruimte/contracts';
import type { MarkerShape } from '@/canvas/marker-path';
import type { EdgeLine } from '@/state/edge-lines';

/* Every meaning a line can have on screen, the plain one included: a line nobody gave a role. */
type LineRole = EdgeRole | 'plain';

export interface EdgeLook {
    tail: MarkerShape;
    head: MarkerShape;
    dashed: boolean;
    /* A line that carries something is drawn in the context color, every other one in the neutral. */
    accent: boolean;
    /* The stroke at rest. Hovered or selected a line is drawn one step heavier than this. */
    width: number;
}

const EDGE_WIDTH = 2;

/* What a line means and which way it is drawn, since a person draws a pair of meanings both ways. */
interface LineMeaning {
    role: LineRole;
    /* Whether the head belongs at the tail end: a target line drawn from the page into the agent. */
    reversed: boolean;
}

/*
 * What a line means. The role written on it decides, from either direction of a pair, since a person
 * sees one line. Without a role, or with a word a newer Ruimte wrote, a line into an agent is the
 * context that agent reads, the way back of a pair included. Between an agent and a device or a page
 * the direction says nothing: the agent reads that node and works in it, so it is a target line
 * either way, with its head at the node being worked on.
 */
function roleOf(line: EdgeLine, reads: (nodeId: string) => boolean, driven: (nodeId: string) => boolean): LineRole {
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
}

export function lineMeaning(line: EdgeLine, reads: (nodeId: string) => boolean, driven: (nodeId: string) => boolean): LineMeaning {
    const role = roleOf(line, reads, driven);
    // The work happens at the end that is driven, so that is where the point of a target line goes.
    return { role, reversed: role === 'target' && driven(line.edge.from) && !driven(line.edge.to) };
}

/*
 * The table of what each kind of line wears. An open task comes before the role: the line under it
 * is a context line the whole time, and only says the task is still out while it is.
 */
function lookOf(role: LineRole, pair: boolean, openTask: boolean): EdgeLook {
    if (openTask) {
        return { tail: 'point', head: 'dot', dashed: true, accent: true, width: EDGE_WIDTH };
    }
    switch (role) {
        case 'context':
            return { tail: pair ? 'dot' : 'point', head: 'dot', dashed: false, accent: true, width: EDGE_WIDTH };
        case 'target':
            return { tail: 'point', head: 'chevron', dashed: false, accent: false, width: EDGE_WIDTH };
        case 'origin':
            // A target line's shape, dashed because it grants nothing: it only says where a node came from.
            return { tail: 'point', head: 'chevron', dashed: true, accent: false, width: EDGE_WIDTH };
        case 'plain':
            return { tail: 'dot', head: 'dot', dashed: false, accent: false, width: EDGE_WIDTH };
    }
}

export function edgeLook(meaning: LineMeaning, { pair, openTask }: { pair: boolean; openTask: boolean }): EdgeLook {
    const look = lookOf(meaning.role, pair, openTask);
    return meaning.reversed ? { ...look, tail: look.head, head: look.tail } : look;
}
