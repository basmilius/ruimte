import { EDGE_ROLES, type ProjectCanvasView, type ProjectEdge } from '@ruimte/contracts';
import { field, orNote, type VerbCall } from './verb.ts';

// Lines drawn per call. Past this it is not linking any more, it is an agent in a loop.
export const MAX_LINKS = 20;

/* What each role is for, offered whenever a call names one this version does not have. */
export const ROLE_LINES: readonly string[] = [
    `roles\t${EDGE_ROLES.join('\t')}`,
    'role\tcontext\tThe head reads the tail with ruimte-context read and may notify along the line; this is what a line without a role already is',
    'role\ttarget\tFrom an agent into something it can drive, such as a device or a page',
    'role\torigin\tOne node opened the other; it says where a node came from and nothing more'
];

// The same ceiling as a list of nodes in a refusal: past it the refusal drowns in lines.
const EDGE_LINES_MAX = 20;

/* What a refusal about a line may offer: only the lines this same call would remove. */
export const edgeLines = (canvas: ProjectCanvasView, takes: (edge: ProjectEdge) => boolean): string[] => {
    const edges = canvas.edges.filter(takes);
    if (edges.length > EDGE_LINES_MAX) {
        return [`detail\truimte-context link list --view ${canvas.id}\tthe ${canvas.edges.length} lines of ${canvas.id}`];
    }
    return orNote(
        edges.map((edge) => ['edge', edge.id, edge.from, edge.to, field(edge.label ?? '')].join('\t')),
        canvas.edges.length === 0
            ? `${canvas.id} has no lines on it`
            : `You have no line on ${canvas.id} to remove; link delete takes a line whose ends are both yours`
    );
};

/*
 * Who drew a line is written down nowhere, so it is read off its ends, the rule `node delete` follows
 * for a node: an end is yours when it is you or a node you made. Both ends have to be, since a line a
 * person drew into an agent is the context that person gave it.
 */
export const ownEnd = (id: string, call: VerbCall): boolean => id === call.caller || call.host.madeBy(id) === call.caller;
