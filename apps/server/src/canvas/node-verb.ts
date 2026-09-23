import { isCanvasView } from '@ruimte/contracts';
import { z } from 'zod';
import { canvasIdFor, defineActionVerb, runAction } from './action-verb.ts';
import { EVERY_KIND_LINE, NODE_VERB_KINDS, REQUIRED_FLAG, kindLine, kindsFor } from './node-kinds.ts';
import { MAX_CANVAS_NODES } from './nodes.ts';
import { unescapeText } from './text-escapes.ts';
import { DRY_RUN_PREVIEW, MAX_TITLE_LENGTH, OPENING_OFF_CANVAS, REVISION_ROW, SCOPE_LINE, TITLE_LINE, field, placeOf, titleField } from './verb.ts';

export { NODE_VERB_KINDS } from './node-kinds.ts';
export { MAX_CANVAS_NODES } from './nodes.ts';

const KIND_MESSAGE = `node new needs a kind: ${NODE_VERB_KINDS.join(', ')}`;

// The required flags are in the summary too: without them the first thing a first-time caller meets is a refusal.
const REQUIRED_NOTE = `${Object.entries(REQUIRED_FLAG)
    .map(([kind, flag], index) => `${index === 0 ? 'A' : 'a'} ${kind} needs --${flag}`)
    .join(', ')}.`;

const LISTED = 'ruimte-context view list lists them';

export const nodeNewAction = defineActionVerb('node', {
    name: 'new',
    action: 'node.create',
    usage: `<${NODE_VERB_KINDS.join('|')}> [--title T] [--text B] [--url U] [--path P] [--source V] [--cwd P] [--view V] [--beside N] [--dry-run]`,
    note: REQUIRED_NOTE,
    dryRun: true,
    params: [
        { syntax: '<kind>', need: 'required', field: 'kind', text: NODE_VERB_KINDS.join(', ') },
        {
            syntax: '--title T',
            need: 'every kind',
            field: 'title',
            text: `The title, at most ${MAX_TITLE_LENGTH} characters; one set here is the node's for good, the session never renames over it`
        },
        { syntax: '--view V', need: 'every kind', field: 'viewId', text: 'The canvas to add to, by view id', more: LISTED },
        { syntax: '--beside N', need: 'every kind', field: 'beside' },
        {
            syntax: '--dry-run',
            need: 'no value',
            text: `Checks everything and makes nothing; the first field is dry-run instead of the id the node would have got and the last names the line it would draw, as <from> -> <new node>; ${DRY_RUN_PREVIEW}`
        },
        {
            syntax: '--text B',
            need: kindsFor('text'),
            field: 'content',
            more: '\\n, \\t and \\\\ are read as escapes, and --text - takes the body from stdin, byte for byte'
        },
        { syntax: '--url U', need: kindsFor('url'), field: 'url' },
        { syntax: '--source V', need: kindsFor('source'), field: 'source', more: LISTED },
        { syntax: '--path P', need: kindsFor('path'), field: 'path', more: 'it has to exist' },
        { syntax: '--cwd P', need: kindsFor('cwd'), field: 'cwd' }
    ],
    detail: [
        'prints\tid\tkind\tview\tedge\tthe id of the new node, its kind, the canvas it landed on and the id of the line drawn from you into it (- when none was drawn)',
        ...NODE_VERB_KINDS.map(kindLine),
        EVERY_KIND_LINE,
        'edge\tA line is drawn from you into the new node, so the canvas says where it came from and not only that it is there',
        'edge\tInto a terminal or a chat that line is context, the direction that makes you readable to it: it can run ruimte-context read on your id',
        "edge\tInto a note, a browser, a file, a drawing or a diagram it lets you read that node, and drive a browser node's page: only an agent reads, so a line with one agent on it is yours whichever way it runs",
        'edge\tOnly a node on that canvas gets one: a chat that is a view of its own, or a node of another canvas, gets no line and the edge column shows -',
        'edge\tBetween two agents it runs one way only: you do not read a new terminal or chat through it. ruimte-context link new --to <its id> draws the line back when you want that too',
        'edge\truimte-context link list lists what is drawn on the canvas now',
        'where\tWithout --view the canvas the caller is a node on; a caller that is a view of its own must name one, and what it adds gets no line',
        'where\tWithout --beside the first free spot right of the caller, or right of everything when the caller is not on that canvas',
        'paths\t--path and --cwd are resolved against the project folder, never against your own directory; both may also be absolute',
        'paths\t--cwd has to stay inside the project folder or a worktree of its repository; --path may point outside and is then stored absolute',
        `limit\tA canvas holds at most ${MAX_CANVAS_NODES} nodes; a terminal or chat starts no process until a client shows it`,
        TITLE_LINE
    ],
    positionals: z.tuple([z.enum(NODE_VERB_KINDS, { error: KIND_MESSAGE })], {
        error: (issue) => (issue.code === 'too_big' ? 'node new takes one kind and nothing else; a title goes in --title' : KIND_MESSAGE)
    }),
    flags: z.object({
        title: titleField('--title', '--title needs a title').optional(),
        text: z.string().transform(unescapeText).optional(),
        url: z.string().min(1, '--url needs an http or https address').optional(),
        path: z.string().min(1, '--path needs the path of a file').optional(),
        source: z.string().min(1, '--source needs the id of a drawing or diagram view').optional(),
        cwd: z.string().min(1, '--cwd needs the path of a directory').optional(),
        view: z.string().min(1, '--view needs the id of a canvas').optional(),
        beside: z.string().min(1, '--beside needs the id of a node on that canvas').optional()
    }),
    async run({ positionals: [kind], flags, dryRun }, call) {
        const viewId = await canvasIdFor(call, placeOf(call), flags.view, OPENING_OFF_CANVAS);
        const made = await runAction(
            call,
            'node.create',
            {
                viewId,
                kind,
                title: flags.title ?? null,
                content: flags.text ?? null,
                url: flags.url ?? null,
                command: null,
                path: flags.path ?? null,
                provider: null,
                at: null,
                source: flags.source ?? null,
                cwd: flags.cwd ?? null,
                beside: flags.beside ?? null
            },
            dryRun
        );
        const edge = made.edge ?? null;
        if (dryRun) {
            // The ends rather than the word "edge": the direction is the thing to check before anything is made.
            return [`dry-run\t${kind}\t${made.viewId}\t${edge ? `${edge.from} -> ${edge.to}` : '-'}`];
        }
        return [`${made.nodeId}\t${made.kind}\t${made.viewId}\t${edge?.edgeId ?? '-'}`];
    }
});

export const nodeDeleteAction = defineActionVerb('node', {
    name: 'delete',
    action: 'node.delete',
    usage: '<nodeId>',
    params: [{ syntax: '<nodeId>', need: 'required', field: 'nodeIds', text: 'The node to remove, by id', more: 'ruimte-context node list lists them' }],
    detail: [
        'prints\tdeleted\tid\tkind\ttitle\tthe node that went',
        'prints\tended\tid\tkind\tthe session it took with it, for a terminal or a chat',
        'prints\tedges\tcount\thow many lines ran into or out of it and went with it',
        'prints\tmembers\tcount\tfor a group: how many nodes stood in the frame and stayed where they are',
        'rule\tOnly a node whose maker is you, which is every node you made with node new, node group, agent or team',
        'rule\tA machine can free every node and view of every project on it; a refusal says whether this one does',
        'rule\tNever your own node, since that would end the session asking',
        'group\tRemoving a group takes the frame and nothing else: the nodes inside it stay where they stand, because they are not yours to remove with it',
        'note\tThe node is found on any canvas of this project, so this takes no --view',
        'see\truimte-context node list\tthe nodes of a canvas, with the ids this takes'
    ],
    positionals: z.tuple([z.string().min(1, 'node delete needs the id of a node')], {
        error: (issue) => (issue.code === 'too_big' ? 'node delete takes one node id and nothing else' : 'node delete needs the id of a node')
    }),
    flags: z.object({}),
    async run({ positionals: [id] }, call) {
        const place = placeOf(call);
        const content = await call.host.read(place.projectId);
        const holding = content.views.filter(isCanvasView).find((view) => view.nodes.some((node) => node.id === id));
        // The action refuses a node on no canvas before it reads the canvas, so any id stands in for one there.
        const deleted = await runAction(call, 'node.delete', { viewId: holding?.id ?? place.canvasId ?? id, nodeIds: [id] });
        const removed = deleted.removed?.[0];
        if (!removed) {
            throw new Error(`node delete removed nothing for ${id}`);
        }
        return [
            `deleted\t${id}\t${removed.kind}\t${field(removed.title)}`,
            ...(removed.ended ? [`ended\t${id}\t${removed.kind}`] : []),
            `edges\t${removed.edges}`,
            ...(removed.members === null ? [] : [`members\t${removed.members}\tleft where they stand`])
        ];
    }
});

export const nodeListAction = defineActionVerb('node', {
    name: 'list',
    action: 'node.list',
    usage: '[--view V]',
    params: [{ syntax: '--view V', need: 'optional', field: 'viewId', text: 'The canvas to list, by view id', more: LISTED }],
    detail: [
        'prints\tid\tkind\ttitle\tx\ty\tw\th\tgroup\tone line per node, rounded to whole pixels',
        'units\tx and y are the top left corner of the node in canvas pixels, w and h its size; the canvas has no edges and x or y may be negative',
        'where\tWithout --view the view you are in, when that is a canvas; from any other view, name one with --view',
        'self\tThe row after the nodes is not a node: it is self and your own id, or self, a dash and a sentence saying so when none of these nodes is you',
        REVISION_ROW,
        'self\tA terminal session also carries its own id in $RUIMTE_SESSION_ID; a chat backend is given none, which is what the self row is for',
        'groups\tA group is a row of kind group; its id is what --group takes on agent, and the group column names the frame a node stands in, empty on the canvas itself',
        'see\truimte-context link list\tthe lines of the same canvas, which this list does not show',
        'note\tA tab or a newline in a title is printed as a space, so a node is always one row',
        SCOPE_LINE
    ],
    positionals: z.tuple([], { error: 'node list takes no arguments, only flags' }),
    flags: z.object({ view: z.string().min(1, '--view needs the id of a canvas').optional() }),
    async run({ flags }, call) {
        const listed = await runAction(call, 'node.list', { viewId: await canvasIdFor(call, placeOf(call), flags.view) });
        return [
            ...listed.nodes.map((node) =>
                [
                    node.nodeId,
                    node.kind,
                    field(node.title),
                    ...[node.x, node.y, node.w, node.h].map((value) => String(Math.round(value))),
                    node.groupId ?? ''
                ].join('\t')
            ),
            // Which row is the caller, which it can read nowhere else: a chat backend has no $RUIMTE_SESSION_ID.
            listed.self === null ? 'self\t-\tnone of these nodes is you' : `self\t${listed.self}`,
            `revision\t${listed.revision}`
        ];
    }
});
