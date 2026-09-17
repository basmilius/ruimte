import { z } from 'zod';
import { nodesNamed } from './node-verb.ts';
import { MAX_TITLE_LENGTH, TITLE_LINE, canvasFor, defineAction, field, placeOf, titleField } from './verb.ts';

const RENAME_DETAIL: readonly string[] = [
    'argument\t<nodeId>\trequired\tThe node to rename, by id; one node per call',
    `flag\t--title T\trequired\tThe new title, at most ${MAX_TITLE_LENGTH} characters, one argument, spaces and all`,
    'flag\t--view V\toptional\tThe canvas the node is on, by view id; ruimte-context view list lists them',
    'prints\tid\tkind\ttitle\tthe node as it now stands',
    "note\tA title set here is the node's for good: the session it holds never renames over it again, which is what a person typing a title does too",
    'note\tA rename to the title it already carries writes nothing and is not a refusal',
    'ids\tOnly ids, never titles; ruimte-context node list lists the nodes of a canvas with theirs',
    'see\truimte-context view rename\trenaming a row in the sidebar instead of a node on a canvas',
    TITLE_LINE
];

export const renameAction = defineAction('node', {
    name: 'rename',
    usage: '<nodeId> --title T [--view V]',
    summary: 'Renames one node and prints id, kind, title; nothing the node hosts renames over it again',
    detail: RENAME_DETAIL,
    positionals: z.tuple([z.string().min(1, 'node rename needs the id of a node')], {
        error: (issue) =>
            issue.code === 'too_big' ? 'node rename takes one node id and nothing else; the title goes in --title' : 'node rename needs the id of a node'
    }),
    flags: z.object({
        title: titleField('--title', '--title needs a title'),
        view: z.string().min(1, '--view needs the id of a canvas').optional()
    }),
    async run({ positionals: [id], flags }, call) {
        const place = placeOf(call);
        return call.host.mutate(place.projectId, (content) => {
            const canvas = canvasFor(content, place, flags.view);
            const [node] = nodesNamed(canvas, [id]);
            const result = [[node!.id, node!.kind, field(flags.title)].join('\t')];
            if (node!.title === flags.title && node!.titleSource === 'user') {
                return { content: null, result };
            }
            const nodes = canvas.nodes.map((candidate) =>
                // A title the agent chose is not one the session may rename, the rule a person's typing follows.
                candidate.id === node!.id ? { ...candidate, title: flags.title, titleSource: 'user' as const } : candidate
            );
            return { content: { ...content, views: content.views.map((view) => (view.id === canvas.id ? { ...canvas, nodes } : view)) }, result };
        });
    }
});
