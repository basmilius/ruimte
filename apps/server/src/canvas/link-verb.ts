import { EDGE_ROLES } from '@ruimte/contracts';
import { z } from 'zod';
import { canvasIdFor, defineActionVerb, runAction } from './action-verb.ts';
import { MAX_LINKS } from './links.ts';
import { idList } from './nodes.ts';
import { MAX_TITLE_LENGTH, SCOPE_LINE, VerbRefusal, field, placeOf, titleField } from './verb.ts';

export { MAX_LINKS } from './links.ts';

/* The flag `agent` and `team` take for the nodes their new agent has to be able to read at once. */
export const readsFlag = z.string().min(1, '--reads needs one or more node ids, separated by commas').optional();

/*
 * The ids of --reads, read before the lock: a bad one should refuse the call before it cuts a
 * worktree. Which nodes they are is only known once the call knows which canvas it lands on.
 */
export const readsIds = (raw: string | undefined): string[] => {
    if (raw === undefined) {
        return [];
    }
    const ids = idList(raw, '--reads');
    if (ids.length > MAX_LINKS) {
        throw new VerbRefusal('too-many-links', `--reads names ${ids.length} nodes and at most ${MAX_LINKS} may be linked at once`);
    }
    return ids;
};

/* What --reads does, said the same way by every verb that takes it; `head` is what its lines run into. */
export const readsLines = (head: string): readonly string[] => [
    `reads\tThe line runs from the node you name into ${head}, the direction that makes that node readable: it can run ruimte-context read on the id`,
    'reads\tNo role and the label context, like every other line this verb draws into an agent',
    'reads\tThe node, its lines and the start of the agent are one write, so a line is there before the first turn runs; this is how you open an agent on a note you just put down',
    'reads\tOnly nodes that are on that canvas already, so never an agent this same call opens; an id that names none of them is refused with the ids that do',
    'reads\tNaming yourself is the line this verb draws from you anyway, which is reported once and never drawn twice',
    'reads\tUnder --dry-run every line it would draw is a row of its own, as <the node> -> <the agent it would run into>',
    `limit\tAt most ${MAX_LINKS} ids in --reads`
];

const LINK_DETAIL: readonly string[] = [
    'prints\tid\tfrom\tto\tstate\tway\tone line per edge, where state is new for one that was drawn, updated for one that was there and took the --role you named, and existing for one nothing happened to',
    'way\tout for the line you asked for, back for the one this verb drew the other way by itself, so two rows for one --to is not a mistake',
    'context\tAn edge into a terminal or a chat node is what lets that agent read the other end with ruimte-context read; a line between two other nodes is only a line',
    'both ways\tA --to that names a terminal or a chat, from a terminal or a chat, is two edges and two rows: each of them then reads the other, and either may notify the other',
    'both ways\tInto anything else it is one edge and one row, since only an agent node reads what a line brings it',
    'both ways\tA --role of target or origin is one edge and one row whatever the two ends are, since either only reads one way',
    'again\tAn edge that is already there is left alone and reported as existing, so running the same link new twice changes nothing',
    'again\tA --role that is not the role on that edge is written onto it and the row says updated; the role it already has, or no --role at all, leaves it as it is',
    `limit\tAt most ${MAX_LINKS} ids in --to`,
    'ids\tOnly ids, never titles; ruimte-context node list lists the nodes of a canvas with theirs',
    'see\truimte-context link list\twhat is drawn on that canvas now, so you can tell a line that is missing from one that is only the other way round',
    'see\truimte-context link delete\tremoving a line again, one direction at a time',
    'see\truimte-context notify\tleaving a message for the agent at the other end, which takes a line running that way'
];

export const linkNewAction = defineActionVerb('link', {
    name: 'new',
    action: 'link.create',
    usage: '--to A,B [--from N] [--label L] [--role R] [--view V]',
    params: [
        { syntax: '--to A,B', need: 'required', field: 'to', text: 'The nodes the line runs into, by id, separated by commas' },
        { syntax: '--from N', need: 'optional', field: 'from' },
        {
            syntax: '--label L',
            need: 'optional',
            field: 'label',
            more: `at most ${MAX_TITLE_LENGTH} characters; a line into an agent is called "context" without one`
        },
        {
            syntax: '--role R',
            need: 'optional',
            field: 'role',
            more: `one of ${EDGE_ROLES.join(', ')}; without it a line into a terminal or a chat is context and any other line is only a line`
        },
        { syntax: '--view V', need: 'optional', field: 'viewId', text: 'The canvas both ends are on, by view id; without it the one you are on' }
    ],
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
        const to = idList(flags.to, '--to');
        const viewId = await canvasIdFor(call, placeOf(call), flags.view);
        const linked = await runAction(call, 'link.create', { viewId, from: flags.from ?? null, to, label: flags.label ?? null, role: flags.role ?? null });
        return linked.edges.map((edge) => [edge.edgeId, edge.from, edge.to, edge.state, edge.way].join('\t'));
    }
});

export const linkListAction = defineActionVerb('link', {
    name: 'list',
    action: 'link.list',
    usage: '[--view V]',
    params: [{ syntax: '--view V', need: 'optional', field: 'viewId', text: 'The canvas to list, by view id', more: 'ruimte-context view list lists them' }],
    detail: [
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
        const listed = await runAction(call, 'link.list', { viewId: await canvasIdFor(call, placeOf(call), flags.view) });
        return listed.edges.map((edge) => [edge.edgeId, edge.from, edge.to, field(edge.label ?? '')].join('\t'));
    }
});

export const linkDeleteAction = defineActionVerb('link', {
    name: 'delete',
    action: 'link.delete',
    usage: '<edgeId> [--view V]',
    params: [
        { syntax: '<edgeId>', need: 'required', field: 'edgeId', text: 'The line to remove, by id', more: 'ruimte-context link list lists them' },
        { syntax: '--view V', need: 'optional', field: 'viewId', text: 'The canvas the line is on, by view id; without it the one you are on' }
    ],
    detail: [
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
        const viewId = await canvasIdFor(call, placeOf(call), flags.view);
        const deleted = await runAction(call, 'link.delete', { viewId, edgeId: id });
        return [['deleted', deleted.edgeId, deleted.from, deleted.to, field(deleted.label ?? '')].join('\t')];
    }
});
