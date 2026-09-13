import { isAgentKind, type ProjectEdge, type ProjectNode } from '@ruimte/contracts';
import { z } from 'zod';
import { newId, nodeLines } from './node-verb.ts';
import { VerbRefusal, canvasFor, defineVerb, placeOf } from './verb.ts';

// Lines drawn per call. Past this it is not linking any more, it is an agent in a loop.
export const MAX_LINKS = 20;

const LINK_DETAIL: readonly string[] = [
    'flag\t--to A,B\trequired\tThe nodes the line runs into, by id, separated by commas',
    'flag\t--from N\toptional\tWhere the line starts; without it, you',
    'flag\t--label L\toptional\tWhat the line is called on the canvas; a line into an agent is called "context" without one',
    'flag\t--view V\toptional\tThe canvas both ends are on, by view id; without it the one you are on',
    'prints\tid\tfrom\tto\tstate\tone line per edge, where state is new for one that was drawn and existing for one that was there already',
    'context\tAn edge into a terminal or a chat node is what lets that agent read the other end with ruimte-context read; a line between two other nodes is only a line',
    'both ways\tBetween two agent nodes the line is drawn in both directions, since each of them then reads the other',
    'again\tAn edge that is already there is left alone and reported as existing, so running the same link twice changes nothing',
    `limit\tAt most ${MAX_LINKS} ids in --to`,
    'ids\tOnly ids, never titles; ruimte-context nodes lists the nodes of a canvas with theirs',
    'see\truimte-context edges\twhat is drawn on that canvas now, so you can tell a line that is missing from one that is only the other way round'
];

const pickId = (edge: ProjectEdge): string => edge.id;

export const linkVerb = defineVerb({
    name: 'link',
    usage: '--to A,B [--from N] [--label L] [--view V]',
    summary: 'Draws a context line between nodes of one canvas, in both directions between two agents',
    detail: LINK_DETAIL,
    positionals: z.tuple([], { error: 'link takes no arguments, only flags; the nodes go in --to' }),
    flags: z.object({
        to: z.string().min(1, '--to needs one or more node ids, separated by commas'),
        from: z.string().min(1, '--from needs the id of a node on that canvas').optional(),
        label: z.string().trim().min(1, '--label needs a word').optional(),
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
                throw new VerbRefusal(
                    'unknown-node',
                    `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not a node on ${canvas.id}`,
                    nodeLines(canvas)
                );
            }
            if (targets.includes(from)) {
                throw new VerbRefusal('self-link', `${from} is both ends of the line; a node reads itself without one`);
            }

            const made: ProjectEdge[] = [];
            const lines: string[] = [];
            const draw = (start: string, end: ProjectNode): void => {
                const already = [...canvas.edges, ...made].find((edge) => edge.from === start && edge.to === end.id);
                if (already) {
                    lines.push([already.id, start, end.id, 'existing'].join('\t'));
                    return;
                }
                // The label a person's own drag gives it: named only where the line means something.
                const label = flags.label ?? (isAgentKind(end.kind) ? 'context' : undefined);
                const edge: ProjectEdge = {
                    id: newId('edge', content, made.map(pickId)),
                    from: start,
                    to: end.id,
                    ...(label === undefined ? {} : { label })
                };
                made.push(edge);
                lines.push([edge.id, start, end.id, 'new'].join('\t'));
            };

            for (const id of targets) {
                const target = canvas.nodes.find((node) => node.id === id)!;
                draw(from, target);
                // Both ways between two agents: each of them is then something the other can read.
                if (isAgentKind(source.kind) && isAgentKind(target.kind)) {
                    draw(id, source);
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
