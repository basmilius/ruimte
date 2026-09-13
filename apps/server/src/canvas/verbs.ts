import { ContextSourceSchema } from '@ruimte/contracts';
import { z } from 'zod';
import { MAX_SCREEN_LINES } from '../context/context-store.ts';
import { agentVerb } from './agent-verb.ts';
import { arrangeVerb } from './arrange-verb.ts';
import { groupVerb } from './group-verb.ts';
import { linkVerb } from './link-verb.ts';
import { renameVerb } from './rename-verb.ts';
import { nodeVerb } from './node-verb.ts';
import { openVerb } from './open-verb.ts';
import { teamVerb } from './team-verb.ts';
import { VIEW_KINDS, deletableView, viewVerb } from './view-verb.ts';
import { DRY_RUN_FLAG, VerbRefusal, canvasFor, defineVerb, dryRunVerbNames, field, placeOf, type ContextVerb, type VerbEntry } from './verb.ts';

/* The one line about failure every help output ends with; the codes are the CLI's, which is what runs the verb. */
const REFUSAL_LINE =
    'refusal\trefused<TAB><code><TAB><message> on stderr, then what you can pick instead\texit 0 done, 1 the daemon failed, 2 not in a Ruimte session, 3 refused';

/* Two things an agent keeps mixing up, so the line is in the list and in the detail of each verb it is about. */
const SCOPE_LINE =
    'scope\tlist and read are what a person linked into this session; nodes, edges, views, node, agent, team, link, view, open, group, arrange and rename are the project itself\ta node you add is readable through read only once a line runs from it into you';

/* Said once under the list, since the flag is on some verbs and refused by name on the rest. */
const dryRunLine = (): string => `dry run\t--${DRY_RUN_FLAG}\t${dryRunVerbNames().join(', ')}\tsame checks, nothing made; every other verb refuses the flag`;

/* Every row says what it is in its first field, so the lines under the list are never read as verbs. */
export const verbSummaryLines = (): string[] => VERBS.map((verb) => `verb\t${verb.name}\t${verb.usage}\t${verb.summary}`);

/* A verb with words of its own prints each of them in full under its own lines, out of the same
   table the dispatch reads, so a subcommand is documented by being defined. */
const subcommandLines = (verb: VerbEntry): string[] =>
    verb.served !== 'canvas' || verb.subcommands === undefined
        ? []
        : verb.subcommands.flatMap((sub) => [`usage\t${sub.name}\t${sub.usage}`, `about\t${sub.name}\t${sub.summary}`, ...sub.detail]);

const detailLines = (verb: VerbEntry): string[] => [
    `usage\t${verb.name}\t${verb.usage}`,
    `about\t${verb.summary}`,
    ...verb.detail,
    ...subcommandLines(verb),
    REFUSAL_LINE
];

const helpVerb = defineVerb({
    name: 'help',
    usage: '[verb]',
    summary: 'Lists every verb: name, arguments, what it does; with a verb, everything that one verb takes',
    detail: [
        'argument\t<verb>\toptional\tThe verb to detail; without one every verb is listed',
        'prints\tverb\tname\targuments\tsummary\tone row per verb; a row that does not start with verb is not one'
    ],
    positionals: z.array(z.string()).max(1, 'help takes one verb name and nothing else'),
    flags: z.object({}),
    run: async ({ positionals: [name] }) => {
        if (name === undefined) {
            return [...verbSummaryLines(), SCOPE_LINE, dryRunLine(), 'detail\truimte-context help <verb>\tone verb in full', REFUSAL_LINE];
        }
        const verb = verbNamed(name);
        if (!verb) {
            throw new VerbRefusal('unknown-verb', `${name} is not a verb`, verbSummaryLines());
        }
        return detailLines(verb);
    }
});

const listVerb: ContextVerb = {
    served: 'context',
    name: 'list',
    usage: '',
    summary: 'Lists the context linked to this session: id, kind, title (also what ruimte-context prints without a verb)',
    detail: [
        'prints\tid\tkind\ttitle\tone line per linked source, nothing when the person linked none',
        `kinds\t${ContextSourceSchema.shape.kind.options.join('\t')}\ta note and a browser address both arrive as text`,
        'note\tThe id is what ruimte-context read takes; this list is the whole of what you may read',
        SCOPE_LINE
    ]
};

const readVerb: ContextVerb = {
    served: 'context',
    name: 'read',
    usage: '<id> [--tail N]',
    summary: 'Prints one linked source, whole or its last N lines',
    detail: [
        'argument\t<id>\trequired\tThe id of a source, from ruimte-context list',
        'flag\t--tail N\toptional\tOnly the last N lines, N a positive whole number; without it the whole source',
        'prints\tThe source itself, as text, not as tab-separated lines',
        'kind\ttext\tThe text the person wrote: a note, a text on the canvas or a browser address\t--tail counts its lines',
        `kind\tterminal\tThe screen of that session, its last ${MAX_SCREEN_LINES} lines, read the moment you ask\t--tail counts screen lines and cannot reach past those ${MAX_SCREEN_LINES}`,
        'kind\tchat\tThe whole thread as markdown: who said what, and what every tool ran\t--tail counts lines of that markdown, so it ends on the latest turn',
        'kind\tdrawing\tThe text of the drawing in reading order, and the picture itself as SVG under it\t--tail counts lines of the reading order and leaves the SVG out',
        'kind\tfile\tIts path and a line telling you to read it yourself, since your own tools see a fresher copy\t--tail does nothing here',
        'cheap\tThe last fifteen lines of a neighbour is usually the whole answer; read the source whole only when it is not',
        SCOPE_LINE
    ]
};

const nodesVerb = defineVerb({
    name: 'nodes',
    usage: '[--view V]',
    summary: 'Lists the nodes of a canvas: id, kind, title, x, y, w, h',
    detail: [
        'flag\t--view V\toptional\tThe canvas to list, by view id; ruimte-context views lists them',
        'prints\tid\tkind\ttitle\tx\ty\tw\th\tone line per node, rounded to whole pixels',
        'units\tx and y are the top left corner of the node in canvas pixels, w and h its size; the canvas has no edges and x or y may be negative',
        'where\tWithout --view the canvas the caller is a node on; a caller that is a view of its own must name one',
        'self\tYour own row is the one whose id is $RUIMTE_SESSION_ID, the variable every terminal session gets; a chat backend is given none',
        'groups\tA group is a row of kind group; its id is what --group takes on agent',
        'see\truimte-context edges\tthe lines of the same canvas, which this list does not show',
        'note\tA tab or a newline in a title is printed as a space, so a node is always one row',
        SCOPE_LINE
    ],
    positionals: z.tuple([], { error: 'nodes takes no arguments, only flags' }),
    flags: z.object({ view: z.string().min(1, '--view needs the id of a canvas').optional() }),
    async run({ flags }, call) {
        const place = placeOf(call);
        const canvas = canvasFor(await call.host.read(place.projectId), place, flags.view);
        return canvas.nodes.map((node) =>
            [node.id, node.kind, field(node.title), ...[node.x, node.y, node.w, node.h].map((value) => String(Math.round(value)))].join('\t')
        );
    }
});

const edgesVerb = defineVerb({
    name: 'edges',
    usage: '[--view V]',
    summary: 'Lists the lines of a canvas: id, from, to, label',
    detail: [
        'flag\t--view V\toptional\tThe canvas to list, by view id; ruimte-context views lists them',
        'prints\tid\tfrom\tto\tlabel\tone line per line on the canvas, the label empty where it has none',
        'direction\tA line runs from the first id into the second; into an agent node that is what makes the first readable to it, and never the other way round',
        'both ways\tTwo agents that read each other are two lines, one each way; ruimte-context link draws the second',
        'where\tWithout --view the canvas the caller is a node on; a caller that is a view of its own must name one',
        'note\tA canvas with no lines on it prints nothing at all',
        SCOPE_LINE
    ],
    positionals: z.tuple([], { error: 'edges takes no arguments, only flags' }),
    flags: z.object({ view: z.string().min(1, '--view needs the id of a canvas').optional() }),
    async run({ flags }, call) {
        const place = placeOf(call);
        const canvas = canvasFor(await call.host.read(place.projectId), place, flags.view);
        return canvas.edges.map((edge) => [edge.id, edge.from, edge.to, field(edge.label ?? '')].join('\t'));
    }
});

const viewsVerb = defineVerb({
    name: 'views',
    usage: '',
    summary: 'Lists the views of the project in sidebar order: id, kind, name, and whether you may delete it',
    detail: [
        'prints\tid\tkind\tname\tdelete\tone line per view, in the order the sidebar has them',
        `kinds\t${VIEW_KINDS.join('\t')}`,
        'delete\tyes or no: whether ruimte-context view delete would remove that view for you',
        'delete\tA view you made yourself is yes; one a person or another agent made is no unless the machine frees every view',
        'note\tA separator is a line in the sidebar and has an empty name',
        'see\truimte-context view\tmaking a view, renaming it, marking it, moving it, removing it'
    ],
    positionals: z.tuple([], { error: 'views takes no arguments' }),
    flags: z.object({}),
    async run(_input, call) {
        const place = placeOf(call);
        const content = await call.host.read(place.projectId);
        const anyView = call.host.agentsDeleteAnyView();
        return content.views.map(
            (view) => `${view.id}\t${view.kind}\t${field(view.name ?? '')}\t${deletableView(view, { caller: call.caller, place, anyView }) ? 'yes' : 'no'}`
        );
    }
});

/* In the order `help` lists them: everything `ruimte-context` does, whichever route serves it. */
export const VERBS: readonly VerbEntry[] = [
    helpVerb,
    listVerb,
    readVerb,
    nodesVerb,
    edgesVerb,
    viewsVerb,
    nodeVerb,
    agentVerb,
    teamVerb,
    linkVerb,
    viewVerb,
    openVerb,
    groupVerb,
    arrangeVerb,
    renameVerb
];

export const verbNamed = (name: string): VerbEntry | undefined => VERBS.find((verb) => verb.name === name);
