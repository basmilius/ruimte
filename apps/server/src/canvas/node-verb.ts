import { NODE_ACCENT_NAMES, isCanvasView, isNodeAccent } from '@ruimte/contracts';
import { MAX_PER_CALL } from '@ruimte/actions';
import { COLOR_LINES } from '../actions/node-actions.ts';
import { z } from 'zod';
import { canvasIdFor, defineActionVerb, runAction } from './action-verb.ts';
import { PROJECT_FLAG, PROJECT_LINE } from './reach.ts';
import { ONE_WRITE, idBatch, jsonBatch } from './batch.ts';
import { EVERY_KIND_LINE, JSON_NODE_KINDS, NODE_VERB_KINDS, REQUIRED_FLAG, kindLine, kindsFor } from './node-kinds.ts';
import { MAX_CANVAS_NODES } from './nodes.ts';
import { unescapeText } from './text-escapes.ts';
import {
    DRY_RUN_PREVIEW,
    MAX_TITLE_LENGTH,
    OPENING_OFF_CANVAS,
    REVISION_ROW,
    SCOPE_LINE,
    SNOOZE_LINE,
    TITLE_LINE,
    VerbRefusal,
    field,
    placeOf,
    titleField,
    oneArgument,
    VIEW_FLAG
} from './verb.ts';

const KIND_MESSAGE = `node new needs a kind: ${NODE_VERB_KINDS.join(', ')}`;

// The required flags are in the summary too: without them the first thing a first-time caller meets is a refusal.
const REQUIRED_NOTE = `${Object.entries(REQUIRED_FLAG)
    .map(([kind, flag], index) => `${index === 0 ? 'A' : 'a'} ${kind} needs --${flag}`)
    .join(', ')}.`;

const LISTED = 'ruimte-context view list lists them';

const NEW_USAGE = `(<${NODE_VERB_KINDS.join('|')}> [--title T] [--text B] [--url U] [--path P] [--source V] [--device D] [--cwd P] [--artifact A] [--version R] [--routine R] [--color C] [--beside N] | --json J) [--view V] [--dry-run]`;

// What the parser answers a call it cannot read with, for the two it cannot catch on its own: no kind, and a kind beside --json.
const NEW_USAGE_LINES = [`usage\tnode new\t${NEW_USAGE}`, 'detail\truimte-context help node new'];

/* One node of a --json call: the kind and the fields of the flags a single call takes, by their flag names. */
const JsonNodeSchema = z.strictObject({
    // An artifact or a routine node is left out: it names what it shows with flags of its own.
    kind: z.enum(JSON_NODE_KINDS, { error: `node new needs a kind: ${JSON_NODE_KINDS.join(', ')}` }),
    title: titleField('title', 'title needs a title').optional(),
    text: z.string().optional(),
    url: z.string().min(1, 'url needs an http or https address').optional(),
    path: z.string().min(1, 'path needs the path of a file').optional(),
    source: z.string().min(1, 'source needs the id of a drawing or diagram view').optional(),
    device: z.string().min(1, 'device needs the id of a device of this machine').optional(),
    cwd: z.string().min(1, 'cwd needs the path of a directory').optional(),
    beside: z.string().min(1, 'beside needs the id of a node on that canvas').optional(),
    color: z.enum(NODE_ACCENT_NAMES, { error: `color takes one of the ${NODE_ACCENT_NAMES.length} colors` }).optional()
});

const JSON_EXAMPLE = `ruimte-context node new --json '[{"kind":"note","title":"Idea","text":"Body","color":"teal"},{"kind":"browser","url":"https://example.com"}]'`;

export const nodeNewAction = defineActionVerb('node', {
    name: 'new',
    action: 'node.create',
    usage: NEW_USAGE,
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
            syntax: '--color C',
            need: 'every kind',
            field: 'color',
            text: `One of the ${NODE_ACCENT_NAMES.length} colors; a note takes its paper from it`,
            more: 'ruimte-context help node color lists them'
        },
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
        { syntax: '--device D', need: kindsFor('device'), field: 'device', more: 'ruimte-context device list lists the ones of this machine' },
        { syntax: '--cwd P', need: kindsFor('cwd'), field: 'cwd' },
        {
            syntax: '--artifact A',
            need: kindsFor('artifact'),
            field: 'artifact',
            more: "an artifact of this project's Output; ruimte-context artifact list lists them"
        },
        {
            syntax: '--version R',
            need: kindsFor('version'),
            field: 'artifactVersion',
            more: 'the node stays on this version; without it the node follows the latest'
        },
        {
            syntax: '--routine R',
            need: kindsFor('routine'),
            field: 'routine',
            more: 'a routine of this project; ruimte-context routine list lists them'
        },
        {
            syntax: '--json J',
            need: 'in place of <kind>',
            text: `Several nodes in one call: an array of up to ${MAX_PER_CALL} objects, each with kind and the fields of the flags above by their names (title, text, url, path, source, device, cwd, beside, color)`,
            more: '--json - takes the array from stdin, a heredoc included'
        }
    ],
    detail: [
        'prints\tid\tkind\tview\tedge\tthe id of the new node, its kind, the canvas it landed on and the id of the line drawn from you into it (- when none was drawn); one line per node, in the order given',
        `many\tTo add several nodes, give them all to one call with --json instead of calling once per node: ${ONE_WRITE}`,
        `many\tEach node is checked the way a single call checks it, placed after the ones before it, and gets its own line from you; a refusal names the node by its place in the array, counted from 1`,
        `example\t${JSON_EXAMPLE}`,
        ...NODE_VERB_KINDS.map(kindLine),
        EVERY_KIND_LINE,
        'edge\tA line is drawn from you into the new node, so the canvas says where it came from and not only that it is there',
        'edge\tInto a terminal or a chat that line is context, the direction that makes you readable to it: it can run ruimte-context read on your id',
        "edge\tInto a note, a browser, a file, a drawing, a diagram or a device it lets you read that node, drive a browser node's page and operate a device: only an agent reads, so a line with one agent on it is yours whichever way it runs",
        'edge\tOnly a node on that canvas gets one: a chat that is a view of its own, or a node of another canvas, gets no line and the edge column shows -. A chat view needs none: it reads and operates every node of the canvas it names with --view',
        'edge\tBetween two agents it runs one way only: you do not read a new terminal or chat through it. ruimte-context link new --to <its id> draws the line back when you want that too',
        'edge\truimte-context link list lists what is drawn on the canvas now',
        'where\tWithout --view the canvas the caller is a node on; a caller that is a view of its own must name one, and what it adds gets no line',
        'where\tWithout --beside the first free spot right of the caller, or right of everything when the caller is not on that canvas',
        'paths\t--path and --cwd are resolved against the project folder, never against your own directory; both may also be absolute',
        'paths\t--cwd has to stay inside the project folder or a worktree of its repository; --path may point outside and is then stored absolute',
        `limit\tA canvas holds at most ${MAX_CANVAS_NODES} nodes; a terminal or chat starts no process until a client shows it`,
        "size\tA new node takes the size a person on this machine gave its kind (Set as default size, in a node's menu), else the built-in size of the kind; agent and team size their nodes the same way, and no verb changes it",
        TITLE_LINE
    ],
    positionals: z.tuple([z.enum(NODE_VERB_KINDS, { error: KIND_MESSAGE }).optional()], {
        error: (issue) => (issue.code === 'too_big' ? 'node new takes one kind and nothing else; a title goes in --title' : KIND_MESSAGE)
    }),
    flags: z.object({
        title: titleField('--title', '--title needs a title').optional(),
        text: z.string().transform(unescapeText).optional(),
        url: z.string().min(1, '--url needs an http or https address').optional(),
        path: z.string().min(1, '--path needs the path of a file').optional(),
        source: z.string().min(1, '--source needs the id of a drawing or diagram view').optional(),
        device: z.string().min(1, '--device needs the id of a device of this machine').optional(),
        cwd: z.string().min(1, '--cwd needs the path of a directory').optional(),
        artifact: z.string().min(1, '--artifact needs the id of an artifact').optional(),
        version: z.string().min(1, '--version needs the id of a version').optional(),
        routine: z.string().min(1, '--routine needs the id of a routine').optional(),
        view: VIEW_FLAG,
        beside: z.string().min(1, '--beside needs the id of a node on that canvas').optional(),
        color: z.string().min(1, '--color needs one of the colors').optional(),
        json: z.string().min(1, '--json needs an array of nodes').optional()
    }),
    async run({ positionals: [kind], flags, dryRun }, call) {
        if (flags.json !== undefined) {
            const single = (['title', 'text', 'url', 'path', 'source', 'device', 'cwd', 'beside', 'color', 'artifact', 'version', 'routine'] as const).filter(
                (flag) => flags[flag] !== undefined
            );
            if (kind !== undefined || single.length > 0) {
                throw new VerbRefusal(
                    'bad-arguments',
                    `--json carries every node with its own fields; leave out ${kind === undefined ? single.map((flag) => `--${flag}`).join(', ') : 'the kind'}`,
                    NEW_USAGE_LINES
                );
            }
            const nodes = jsonBatch(flags.json, JsonNodeSchema, JSON_EXAMPLE);
            const made = await runAction(
                call,
                'node.createMany',
                {
                    viewId: await canvasIdFor(call, placeOf(call), flags.view, OPENING_OFF_CANVAS),
                    nodes: nodes.map((node) => ({
                        kind: node.kind,
                        title: node.title ?? null,
                        content: node.text ?? null,
                        url: node.url ?? null,
                        path: node.path ?? null,
                        source: node.source ?? null,
                        cwd: node.cwd ?? null,
                        beside: node.beside ?? null,
                        device: node.device ?? null,
                        color: node.color ?? null
                    }))
                },
                dryRun
            );
            return made.nodes.map((node) =>
                dryRun
                    ? `dry-run\t${node.kind}\t${made.viewId}\t${node.edge ? `${node.edge.from} -> ${node.edge.to}` : '-'}`
                    : `${node.nodeId}\t${node.kind}\t${made.viewId}\t${node.edge?.edgeId ?? '-'}`
            );
        }
        if (kind === undefined) {
            throw new VerbRefusal('bad-arguments', KIND_MESSAGE, NEW_USAGE_LINES);
        }
        if (flags.color !== undefined && !isNodeAccent(flags.color)) {
            throw new VerbRefusal('unknown-color', `${flags.color} is not one of the ${NODE_ACCENT_NAMES.length} colors a node takes`, [...COLOR_LINES]);
        }
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
                device: flags.device ?? null,
                cwd: flags.cwd ?? null,
                beside: flags.beside ?? null,
                color: flags.color ?? null,
                artifact: flags.artifact ?? null,
                artifactVersion: flags.version ?? null,
                routine: flags.routine ?? null
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
    usage: '<nodeId>[,<nodeId>...]',
    params: [
        {
            syntax: '<nodeId>[,<nodeId>...]',
            need: 'required',
            field: 'nodeIds',
            text: `The nodes to remove, by id, separated by commas; at most ${MAX_PER_CALL}, all on one canvas`,
            more: 'ruimte-context node list lists them'
        }
    ],
    detail: [
        'prints\tdeleted\tid\tkind\ttitle\tthe node that went',
        'prints\tended\tid\tkind\tthe session it took with it, for a terminal or a chat',
        'prints\tedges\tcount\thow many lines ran into or out of it and went with it',
        'prints\tmembers\tcount\tfor a group: how many nodes stood in the frame and stayed where they are',
        'order\tThose rows come once per node, in the order given',
        `many\tTo remove several nodes, name them all in one call, as a,b,c, instead of calling once per node: ${ONE_WRITE}`,
        'many\tEach node is checked the way a single one is, and a refusal names the node',
        'rule\tOnly a node whose maker is you, which is every node you made with node new, node group, agent or team',
        'rule\tA machine can free every node and view of every project on it; a refusal says whether this one does',
        'rule\tNever your own node, since that would end the session asking',
        'group\tRemoving a group takes the frame and nothing else: the nodes inside it stay where they stand, because they are not yours to remove with it',
        'group\tA group emptied by removing its last member goes with it, together with its connections',
        'note\tThe nodes are found on any canvas of this project, so this takes no --view; one call takes the nodes of one canvas',
        'see\truimte-context node list\tthe nodes of a canvas, with the ids this takes'
    ],
    positionals: oneArgument('node delete needs the id of a node', 'node delete takes its node ids in one argument, separated by commas, as a,b,c'),
    flags: z.object({}),
    async run({ positionals: [raw] }, call) {
        const ids = idBatch(raw, 'node delete');
        const place = placeOf(call);
        const content = await call.host.projects.read(place.projectId);
        const canvases = content.views.filter(isCanvasView);
        const holders = ids.flatMap((id) => {
            const holding = canvases.find((view) => view.nodes.some((node) => node.id === id));
            return holding === undefined ? [] : [{ id, viewId: holding.id }];
        });
        const other = holders.find((holder) => holder.viewId !== holders[0]!.viewId);
        if (other !== undefined) {
            throw new VerbRefusal(
                'bad-arguments',
                `node delete takes the nodes of one canvas per call, and ${holders[0]!.id} is on ${holders[0]!.viewId} while ${other.id} is on ${other.viewId}`
            );
        }
        // The action refuses a node on no canvas before it reads the canvas, so any id stands in for one there.
        const deleted = await runAction(call, 'node.delete', { viewId: holders[0]?.viewId ?? place.canvasId ?? ids[0]!, nodeIds: ids });
        const removed = deleted.removed ?? [];
        if (removed.length !== ids.length) {
            throw new Error(`node delete removed ${removed.length} of ${ids.join(', ')}`);
        }
        return removed.flatMap((node) => [
            `deleted\t${node.nodeId}\t${node.kind}\t${field(node.title)}`,
            ...(node.ended ? [`ended\t${node.nodeId}\t${node.kind}`] : []),
            `edges\t${node.edges}`,
            ...(node.members === null ? [] : [`members\t${node.members}\tleft where they stand`])
        ]);
    }
});

export const nodeListAction = defineActionVerb('node', {
    name: 'list',
    action: 'node.list',
    usage: '[--view V]',
    params: [{ syntax: '--view V', need: 'optional', field: 'viewId', text: 'The canvas to list, by view id', more: LISTED }],
    detail: [
        'prints\tid\tkind\ttitle\tx\ty\tw\th\tgroup\tflag\tsnoozed\tone line per node, rounded to whole pixels',
        'units\tx and y are the top left corner of the node in canvas pixels, w and h its size; the canvas has no edges and x or y may be negative',
        'where\tWithout --view the view you are in, when that is a canvas; from any other view, name one with --view',
        'self\tThe row after the nodes is not a node: it is self and your own id, or self, a dash and a sentence saying so when none of these nodes is you',
        REVISION_ROW,
        'self\tA terminal session also carries its own id in $RUIMTE_SESSION_ID; a chat backend is given none, which is what the self row is for',
        'groups\tA group is a row of kind group; its id is what --group takes on agent, and the group column names the frame a node stands in, empty on the canvas itself',
        'flag\tThe color of the flag the person put on the node, or - for none; ruimte-context flag sets one',
        SNOOZE_LINE,
        'see\truimte-context link list\tthe lines of the same canvas, which this list does not show',
        'note\tA tab or a newline in a title is printed as a space, so a node is always one row',
        PROJECT_LINE,
        SCOPE_LINE
    ],
    positionals: z.tuple([], { error: 'node list takes no arguments, only flags' }),
    flags: z.object({ view: VIEW_FLAG, project: PROJECT_FLAG }),
    async run({ flags }, call) {
        const listed = await runAction(call, 'node.list', { viewId: await canvasIdFor(call, placeOf(call), flags.view) });
        return [
            ...listed.nodes.map((node) =>
                [
                    node.nodeId,
                    node.kind,
                    field(node.title),
                    ...[node.x, node.y, node.w, node.h].map((value) => String(Math.round(value))),
                    node.groupId ?? '',
                    node.flag ?? '-',
                    node.snoozedUntil ?? '-'
                ].join('\t')
            ),
            // Which row is the caller, which it can read nowhere else: a chat backend has no $RUIMTE_SESSION_ID.
            listed.self === null ? 'self\t-\tnone of these nodes is you' : `self\t${listed.self}`,
            `revision\t${listed.revision}`
        ];
    }
});
