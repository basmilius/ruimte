import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { z } from 'zod';
import { nodeLines } from './node-verb.ts';
import { unescapeText } from './text-escapes.ts';
import { VerbRefusal, canvasFor, defineAction, placeOf, type VerbCall } from './verb.ts';

const NEEDS_TEXT = '--text needs the body to write, in quotes';

const APPEND_FLAG = 'append';

const EDIT_DETAIL: readonly string[] = [
    'argument\t<nodeId>\trequired\tThe note to write in, by id; one note per call',
    'flag\t--text B\trequired\tWhat to write; \\n, \\t and \\\\ are read as escapes, and --text - takes it from stdin, byte for byte',
    `flag\t--${APPEND_FLAG}\tno value\tAdds the text as a line under what is there instead of replacing the body`,
    'flag\t--view V\toptional\tThe canvas the note is on, by view id; ruimte-context view list lists them',
    'prints\tedited\tid\tlines\tcharacters\tthe note as it now stands, so an append tells you how much is written there in total',
    "kind\tOnly a note: a file node is the file system's, and a browser, a terminal and a chat show what they run, not text of yours",
    'who\tA note you made yourself, or one a line joins you to, whichever way that line runs: a person drawing that line is what says you may write here',
    'who\tThe same line lets you read the note back with ruimte-context read, which only runs from the note into you',
    'append\tThe text lands on a line of its own under what is there, so two agents writing in turn never drop what the other put down',
    'append\tEach call reads the note in the moment it writes it, so an append that crosses another keeps both lines',
    'note\tThe body it already carries writes nothing and is not a refusal',
    'note\tWithout --append the old body is gone; on a note you share with another agent that is what --append is for',
    'refusals\tnot-a-note\tnot-linked\tunknown-node\tthe whole set this action refuses with',
    'ids\tOnly ids, never titles; ruimte-context node list lists the nodes of a canvas with theirs',
    'see\truimte-context node new note --text B\tadding the note in the first place',
    'see\truimte-context link new --to <id>\tthe line that makes a note somebody else made yours to write in'
];

/*
 * Who may write in a note. Not the maker alone, the way `node delete` reads a node: a shared note is
 * the point, and two agents cannot keep one between them when only the one that made it may write.
 * A line is what a person drew, so it is what grants this, and either direction counts, since a note
 * holds no agent and a line into it reads as the same relationship as one out of it.
 */
const mayWrite = (canvas: ProjectCanvasView, node: ProjectNode, call: VerbCall): boolean =>
    call.host.madeBy(node.id) === call.caller ||
    canvas.edges.some((edge) => (edge.from === call.caller && edge.to === node.id) || (edge.to === call.caller && edge.from === node.id));

/* What a refusal may offer instead: only the notes this same call would really write in. */
const writableLines = (canvas: ProjectCanvasView, call: VerbCall): string[] =>
    nodeLines(canvas, {
        takes: (node) => node.kind === 'note' && mayWrite(canvas, node, call),
        empty: `${canvas.id} has no note you may write in; ruimte-context node new note --text B adds one of your own`
    });

/* The text as a line of its own under what is there, and nothing but the text on a note still empty. */
const withLine = (body: string, text: string): string => {
    if (body === '') {
        return text;
    }
    return `${body}${body.endsWith('\n') ? '' : '\n'}${text}`;
};

export const nodeEditAction = defineAction('node', {
    name: 'edit',
    usage: `<nodeId> --text B [--${APPEND_FLAG}] [--view V]`,
    summary: 'Writes the body of a note you made or a line joins you to; --append puts the text under what is there instead of over it',
    detail: EDIT_DETAIL,
    positionals: z.tuple([z.string().min(1, 'node edit needs the id of a note')], {
        error: (issue) =>
            issue.code === 'too_big' ? 'node edit takes one node id and nothing else; the body goes in --text' : 'node edit needs the id of a note'
    }),
    switches: [APPEND_FLAG],
    flags: z.object({
        text: z.string({ error: NEEDS_TEXT }).transform(unescapeText),
        view: z.string().min(1, '--view needs the id of a canvas').optional()
    }),
    async run({ positionals: [id], flags, switches }, call) {
        const place = placeOf(call);
        const append = switches.has(APPEND_FLAG);
        if (append && flags.text === '') {
            throw new VerbRefusal('bad-arguments', `--${APPEND_FLAG} has nothing to add: --text is empty; leave --${APPEND_FLAG} off to empty the note`);
        }
        return call.host.mutate(place.projectId, (content) => {
            const canvas = canvasFor(content, place, flags.view);
            const node = canvas.nodes.find((candidate) => candidate.id === id);
            if (!node) {
                throw new VerbRefusal('unknown-node', `${id} is not a node on ${canvas.id}`, writableLines(canvas, call));
            }
            if (node.kind !== 'note') {
                throw new VerbRefusal(
                    'not-a-note',
                    `${id} is a ${node.kind} node and only a note holds a body to write; what a file, a browser, a terminal or a chat shows is not yours to set`,
                    writableLines(canvas, call)
                );
            }
            if (!mayWrite(canvas, node, call)) {
                throw new VerbRefusal('not-linked', `${id} is a note you did not make and no line joins you to it: draw that line and you can write in it`, [
                    ...writableLines(canvas, call),
                    `see\truimte-context link new --to ${id}\tdraws the line this needs`
                ]);
            }
            /*
             * The body is read here and nowhere earlier. `mutate` runs under the project's lock
             * against the document as it stands, so two agents appending in the same breath queue
             * up and the second one writes its line under the first instead of over it.
             */
            const body = node.body ?? '';
            const next = append ? withLine(body, flags.text) : flags.text;
            const result = [`edited\t${id}\t${next === '' ? 0 : next.split('\n').length}\t${next.length}`];
            if (next === body) {
                return { content: null, result };
            }
            const nodes = canvas.nodes.map((candidate) => (candidate.id === id ? { ...candidate, body: next } : candidate));
            return {
                content: { ...content, views: content.views.map((view) => (view.id === canvas.id ? { ...canvas, nodes } : view)) },
                result
            };
        });
    }
});
