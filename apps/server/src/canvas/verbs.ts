import { z } from 'zod';
import { nodeVerb } from './node-verb.ts';
import { VerbRefusal, canvasFor, defineVerb, field, placeOf, type ContextVerb, type VerbEntry } from './verb.ts';

/* The one line about failure every help output ends with; the codes are the CLI's, which is what runs the verb. */
const REFUSAL_LINE =
    'refusal\trefused<TAB><code><TAB><message> on stderr, then what you can pick instead\texit 0 done, 1 the daemon failed, 2 not in a Ruimte session, 3 refused';

const summaryLines = (): string[] => VERBS.map((verb) => `${verb.name}\t${verb.usage}\t${verb.summary}`);

const detailLines = (verb: VerbEntry): string[] => [`usage\t${verb.name}\t${verb.usage}`, `about\t${verb.summary}`, ...verb.detail, REFUSAL_LINE];

const helpVerb = defineVerb({
    name: 'help',
    usage: '[verb]',
    summary: 'Lists every verb: name, arguments, what it does; with a verb, everything that one verb takes',
    detail: [
        'argument\t<verb>\toptional\tThe verb to detail; without one every verb is listed',
        'prints\tname\targuments\tsummary\tone line per verb, or the detail of the verb you named'
    ],
    positionals: z.array(z.string()).max(1, 'help takes one verb name and nothing else'),
    flags: z.object({}),
    run: async ({ positionals: [name] }) => {
        if (name === undefined) {
            return [...summaryLines(), REFUSAL_LINE];
        }
        const verb = verbNamed(name);
        if (!verb) {
            throw new VerbRefusal('unknown-verb', `${name} is not a verb`, summaryLines());
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
        'note\tAnswered by GET /context, so the CLI runs it; POST /canvas/list is refused'
    ]
};

const readVerb: ContextVerb = {
    served: 'context',
    name: 'read',
    usage: '<id>',
    summary: 'Prints one linked source',
    detail: [
        'argument\t<id>\trequired\tThe id of a source, from ruimte-context list',
        'prints\tThe source itself, as text, not as tab-separated lines',
        'note\tAnswered by GET /context, so the CLI runs it; POST /canvas/read is refused'
    ]
};

const nodesVerb = defineVerb({
    name: 'nodes',
    usage: '[--view V]',
    summary: 'Lists the nodes of a canvas: id, kind, title, x, y, w, h',
    detail: [
        'flag\t--view V\toptional\tThe canvas to list, by view id; ruimte-context views lists them',
        'prints\tid\tkind\ttitle\tx\ty\tw\th\tone line per node, coordinates rounded to whole pixels',
        'where\tWithout --view the canvas the caller is a node on; a caller that is a view of its own must name one',
        'note\tA tab or a newline in a title is printed as a space, so a node is always one row'
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

const viewsVerb = defineVerb({
    name: 'views',
    usage: '',
    summary: 'Lists the views of the project in sidebar order: id, kind, name',
    detail: [
        'prints\tid\tkind\tname\tone line per view, in the order the sidebar has them',
        'kinds\tcanvas\tchat\tterminal\tbrowser\tdrawing\tfile\tseparator',
        'note\tA separator is a line in the sidebar and has an empty name'
    ],
    positionals: z.tuple([], { error: 'views takes no arguments' }),
    flags: z.object({}),
    async run(_input, call) {
        const content = await call.host.read(placeOf(call).projectId);
        return content.views.map((view) => `${view.id}\t${view.kind}\t${field(view.name ?? '')}`);
    }
});

/* In the order `help` lists them: everything `ruimte-context` does, whichever route serves it. */
export const VERBS: readonly VerbEntry[] = [helpVerb, listVerb, readVerb, nodesVerb, viewsVerb, nodeVerb];

export const verbNamed = (name: string): VerbEntry | undefined => VERBS.find((verb) => verb.name === name);
