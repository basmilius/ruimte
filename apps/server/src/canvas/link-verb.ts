import { EDGE_ROLES, isAgentKind, type ProjectCanvasView, type ProjectEdge, type ProjectNode } from '@ruimte/contracts';
import { z } from 'zod';
import { newId, nodeLines } from './node-verb.ts';
import { MAX_TITLE_LENGTH, SCOPE_LINE, VerbRefusal, canvasFor, defineAction, field, orNote, placeOf, titleField, type VerbCall } from './verb.ts';

// Lines drawn per call. Past this it is not linking any more, it is an agent in a loop.
export const MAX_LINKS = 20;

/* What each role is for, offered whenever a call names one this version does not have. */
const ROLE_LINES: readonly string[] = [
    `roles\t${EDGE_ROLES.join('\t')}`,
    'role\tcontext\tThe head reads the tail with ruimte-context read and may notify along the line; this is what a line without a role already is',
    'role\ttarget\tFrom an agent into something it can drive, such as a device or a page',
    'role\torigin\tOne node opened the other; it says where a node came from and nothing more'
];

const LINK_DETAIL: readonly string[] = [
    'flag\t--to A,B\trequired\tThe nodes the line runs into, by id, separated by commas',
    'flag\t--from N\toptional\tWhere the line starts; without it, you',
    `flag\t--label L\toptional\tWhat the line is called on the canvas, at most ${MAX_TITLE_LENGTH} characters; a line into an agent is called "context" without one`,
    `flag\t--role R\toptional\tWhat the line is for: ${EDGE_ROLES.join(', ')}; without it a line into a terminal or a chat is context and any other line is only a line`,
    'flag\t--view V\toptional\tThe canvas both ends are on, by view id; without it the one you are on',
    'prints\tid\tfrom\tto\tstate\tway\tone line per edge, where state is new for one that was drawn and existing for one that was there already',
    'way\tout for the line you asked for, back for the one this verb drew the other way by itself, so two rows for one --to is not a mistake',
    'context\tAn edge into a terminal or a chat node is what lets that agent read the other end with ruimte-context read; a line between two other nodes is only a line',
    'both ways\tA --to that names a terminal or a chat, from a terminal or a chat, is two edges and two rows: each of them then reads the other, and either may notify the other',
    'both ways\tInto anything else it is one edge and one row, since only an agent node reads what a line brings it',
    'both ways\tA --role of target or origin is one edge and one row whatever the two ends are, since either only reads one way',
    'again\tAn edge that is already there is left alone and reported as existing, so running the same link new twice changes nothing',
    `limit\tAt most ${MAX_LINKS} ids in --to`,
    'ids\tOnly ids, never titles; ruimte-context node list lists the nodes of a canvas with theirs',
    'see\truimte-context link list\twhat is drawn on that canvas now, so you can tell a line that is missing from one that is only the other way round',
    'see\truimte-context link delete\tremoving a line again, one direction at a time',
    'see\truimte-context notify\tleaving a message for the agent at the other end, which takes a line running that way'
];

const pickId = (edge: ProjectEdge): string => edge.id;

export const linkNewAction = defineAction('link', {
    name: 'new',
    usage: '--to A,B [--from N] [--label L] [--role R] [--view V]',
    summary: 'Draws a context line between nodes of one canvas; between two agents it draws both ways, which is two rows',
    detail: LINK_DETAIL,
    positionals: z.tuple([], { error: 'link new takes no arguments, only flags; the nodes go in --to' }),
    flags: z.object({
        to: z.string().min(1, '--to needs one or more node ids, separated by commas'),
        from: z.string().min(1, '--from needs the id of a node on that canvas').optional(),
        label: titleField('--label', '--label needs a word').optional(),
        role: z
            .string()
            .min(1, `--role needs one of ${EDGE_ROLES.join(', ')}`)
            .optional(),
        view: z.string().min(1, '--view needs the id of a canvas').optional()
    }),
    async run({ flags }, call) {
        const place = placeOf(call);
        const targets = [...new Set(flags.to.split(',').map((id) => id.trim()))];
        if (targets.some((id) => id === '')) {
            throw new VerbRefusal('bad-arguments', '--to has an empty id in it; write the ids separated by commas, as a,b,c');
        }
        if (targets.length > MAX_LINKS) {
            throw new VerbRefusal('too-many-links', `--to names ${targets.length} nodes and at most ${MAX_LINKS} may be linked at once`);
        }
        const role = flags.role;
        if (role !== undefined && !(EDGE_ROLES as readonly string[]).includes(role)) {
            throw new VerbRefusal('unknown-role', `${role} is not one of the ${EDGE_ROLES.length} things a line can be for`, [...ROLE_LINES]);
        }
        /* A line that reads: the role says so, or nothing was said and a line into an agent has read
           the other end since before the field existed. The only kind drawn back, and the only one
           this verb calls "context" by itself. */
        const reads = role === undefined || role === 'context';

        return call.host.mutate(place.projectId, (content) => {
            const canvas = canvasFor(content, place, flags.view);
            const from = flags.from ?? call.caller;
            const source = canvas.nodes.find((node) => node.id === from);
            if (!source) {
                throw new VerbRefusal(
                    'unknown-node',
                    flags.from === undefined
                        ? `You are not a node on ${canvas.id}, so a line has nowhere to start; name one with --from`
                        : `${from} is not a node on ${canvas.id}`,
                    nodeLines(canvas)
                );
            }
            const missing = targets.filter((id) => !canvas.nodes.some((node) => node.id === id));
            if (missing.length > 0) {
                throw new VerbRefusal('unknown-node', `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not a node on ${canvas.id}`, [
                    // Never the node the line starts from: a line into itself is refused a moment later.
                    ...nodeLines(canvas, {
                        takes: (node) => node.id !== from,
                        empty: `${canvas.id} holds no other node for a line to run into`
                    })
                ]);
            }
            if (targets.includes(from)) {
                throw new VerbRefusal('self-link', `${from} is both ends of the line; a node reads itself without one`);
            }

            const made: ProjectEdge[] = [];
            const lines: string[] = [];
            /* `way` is what tells the two rows of one --to apart: the line that was asked for, and
               the one this verb draws back by itself between two agents. */
            const draw = (start: string, end: ProjectNode, way: 'out' | 'back'): void => {
                const already = [...canvas.edges, ...made].find((edge) => edge.from === start && edge.to === end.id);
                if (already) {
                    lines.push([already.id, start, end.id, 'existing', way].join('\t'));
                    return;
                }
                // The label a person's own drag gives it: named only where the line means something.
                const label = flags.label ?? (reads && isAgentKind(end.kind) ? 'context' : undefined);
                const edge: ProjectEdge = {
                    id: newId('edge', content, made.map(pickId)),
                    from: start,
                    to: end.id,
                    ...(label === undefined ? {} : { label }),
                    ...(role === undefined ? {} : { role })
                };
                made.push(edge);
                lines.push([edge.id, start, end.id, 'new', way].join('\t'));
            };

            for (const id of targets) {
                const target = canvas.nodes.find((node) => node.id === id)!;
                draw(from, target, 'out');
                /* Both ways between two agents: each of them is then something the other can read.
                   Only for a line that reads; a target or an origin means something in one direction
                   only, so the copy back would be a line that says something nobody meant. */
                if (reads && isAgentKind(source.kind) && isAgentKind(target.kind)) {
                    draw(id, source, 'back');
                }
            }
            if (made.length === 0) {
                return { content: null, result: lines };
            }
            return {
                content: {
                    ...content,
                    views: content.views.map((view) => (view.id === canvas.id ? { ...canvas, edges: [...canvas.edges, ...made] } : view))
                },
                result: lines
            };
        });
    }
});

export const linkListAction = defineAction('link', {
    name: 'list',
    usage: '[--view V]',
    summary: 'Lists the lines of a canvas: id, from, to, label',
    detail: [
        'flag\t--view V\toptional\tThe canvas to list, by view id; ruimte-context view list lists them',
        'prints\tid\tfrom\tto\tlabel\tone line per line on the canvas, the label empty where it has none',
        'direction\tA line runs from the first id into the second; into an agent node that is what makes the first readable to it, and never the other way round',
        'both ways\tTwo agents that read each other are two lines, one each way; ruimte-context link new draws the second',
        'where\tWithout --view the canvas the caller is a node on; a caller that is a view of its own must name one',
        'note\tA canvas with no lines on it prints nothing at all',
        SCOPE_LINE
    ],
    positionals: z.tuple([], { error: 'link list takes no arguments, only flags' }),
    flags: z.object({ view: z.string().min(1, '--view needs the id of a canvas').optional() }),
    async run({ flags }, call) {
        const place = placeOf(call);
        const canvas = canvasFor(await call.host.read(place.projectId), place, flags.view);
        return canvas.edges.map((edge) => [edge.id, edge.from, edge.to, field(edge.label ?? '')].join('\t'));
    }
});

// The same ceiling as a list of nodes in a refusal: past it the refusal drowns in lines.
const EDGE_LINES_MAX = 20;

/* What a refusal about a line may offer: only the lines this same call would remove. */
const edgeLines = (canvas: ProjectCanvasView, takes: (edge: ProjectEdge) => boolean): string[] => {
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
const ownEnd = (id: string, call: VerbCall): boolean => id === call.caller || call.host.madeBy(id) === call.caller;

export const linkDeleteAction = defineAction('link', {
    name: 'delete',
    usage: '<edgeId> [--view V]',
    summary: 'Removes one line whose ends are both yours and prints the line that went',
    detail: [
        'argument\t<edgeId>\trequired\tThe line to remove, by id; ruimte-context link list lists them',
        'flag\t--view V\toptional\tThe canvas the line is on, by view id; without it the one you are on',
        'prints\tdeleted\tid\tfrom\tto\tlabel\tthe line that went, the label empty where it had none',
        'rule\tOnly a line whose ends are both yours: you, or a node you made with node new, node group, agent or team',
        'rule\tA line that touches a node a person made stays, and so does a line a person drew into you, since that is the context they gave you',
        'rule\tA machine can free every node and view of every project on it, and every line with them; a refusal says whether this one does',
        'both ways\tTwo agents that read each other are two lines, one each way; this removes the one you name and leaves the other',
        'ends\tBoth nodes stay where they are; node delete removes a node together with its lines',
        'see\truimte-context link list\tthe lines of a canvas, with the ids this takes'
    ],
    positionals: z.tuple([z.string().min(1, 'link delete needs the id of a line')], {
        error: (issue) => (issue.code === 'too_big' ? 'link delete takes one line id and nothing else' : 'link delete needs the id of a line')
    }),
    flags: z.object({ view: z.string().min(1, '--view needs the id of a canvas').optional() }),
    async run({ positionals: [id], flags }, call) {
        const place = placeOf(call);
        const anyLine = call.host.agentsDeleteAnyView();
        const deletable = (edge: ProjectEdge): boolean => anyLine || (ownEnd(edge.from, call) && ownEnd(edge.to, call));
        return call.host.mutate(place.projectId, (content) => {
            const canvas = canvasFor(content, place, flags.view);
            const edge = canvas.edges.find((candidate) => candidate.id === id);
            if (!edge) {
                throw new VerbRefusal('unknown-edge', `${id} is not a line on ${canvas.id}`, edgeLines(canvas, deletable));
            }
            if (!deletable(edge)) {
                const foreign = ownEnd(edge.from, call) ? edge.to : edge.from;
                const maker = call.host.madeBy(foreign) ?? 'a person';
                throw new VerbRefusal(
                    'not-yours',
                    `${id} runs ${foreign === edge.from ? 'from' : 'into'} ${foreign}, which ${maker} made, and link delete only removes a line whose ends are both yours`,
                    [
                        `made by\t${foreign}\t${maker}`,
                        `you\t${call.caller}`,
                        "setting\tagentsDeleteAnyView in this machine's endpoint.json frees every node, view and line; a person turns it on from the Machines pane"
                    ]
                );
            }
            const edges = canvas.edges.filter((candidate) => candidate.id !== id);
            return {
                content: { ...content, views: content.views.map((view) => (view.id === canvas.id ? { ...canvas, edges } : view)) },
                result: [['deleted', edge.id, edge.from, edge.to, field(edge.label ?? '')].join('\t')]
            };
        });
    }
});
