import { isAgentKind } from '@ruimte/contracts';
import { z } from 'zod';
import { MAX_NOTICE_LENGTH, MAX_NOTICES, NOTICE_MAX_AGE_MS } from '../context/notices.ts';
import { unescapeText } from './text-escapes.ts';
import { VerbRefusal, canvasFor, defineVerb, field, lengthOf, orNote, placeOf } from './verb.ts';

const NEEDS_TEXT = '--text needs the message to leave, in quotes';

const NOTICE_HOURS = Math.round(NOTICE_MAX_AGE_MS / 3_600_000);

const NOTIFY_DETAIL: readonly string[] = [
    'argument\t<id>\trequired\tThe node to notify, by id; ruimte-context edges lists the lines you have',
    `flag\t--text M\trequired\tThe message, at most ${MAX_NOTICE_LENGTH} characters; \\n, \\t and \\\\ are read as escapes, and --text - takes it from stdin`,
    'prints\tnotified\tid\twhen\twhat happened\twhen is now for a message that landed as you called, waiting for one that is held',
    'who\tOnly a node a line runs from you into, which is the same direction that makes you readable to it; ruimte-context link draws that line',
    'who\tA link --to that names a terminal or a chat draws both ways at once, two edges and two rows, so one call is enough to be able to notify it and be notified back',
    'terminal\tA shell with no agent in it gets the line on its screen at once, dimmed, the way the linked context is announced',
    'terminal\tAn agent that answers a context hook (Claude Code today) hears it at the start of its next turn; another CLI gets the line on its screen instead',
    'terminal\tA screen is as wide as the node is, so a long message is wrapped across lines there; it reaches an agent whole either way',
    'chat\tA chat hears it in front of its next prompt, beside what it is told about links that changed',
    'waiting\tA node that runs nothing yet keeps the message until it starts',
    `waiting\tAt most ${MAX_NOTICES} messages wait per node, the oldest dropped first, and one nobody picks up in ${NOTICE_HOURS} hours is dropped; each is delivered once`,
    'not\tThis is a message, not a command: nothing is typed into that shell and no turn is started by it',
    'not\tYou never hear that it was read: the answer says where it went and nothing after that, and waiting means it sits there until that agent takes its next turn',
    'reply\tThere is no reply channel; the other node answers with a notify of its own, which needs a line running the other way, or you read what it did with ruimte-context read',
    'refusals\tnot-linked\tself-notify\tnot-an-agent\tunknown-node\tnot-on-a-canvas\tthe whole set this verb refuses with',
    'ids\tOnly ids, never titles; ruimte-context nodes lists the nodes of a canvas with theirs'
];

export const notifyVerb = defineVerb({
    name: 'notify',
    usage: '<id> --text "..."',
    summary: 'Leaves a short message for the agent in another node, along a line that runs from you into it',
    detail: NOTIFY_DETAIL,
    positionals: z.tuple([z.string({ error: 'notify takes the id of the node to notify' }).min(1, 'notify takes the id of the node to notify')], {
        error: (issue) =>
            issue.code === 'too_big' ? 'notify takes one id and nothing else; the message goes in --text' : 'notify takes the id of the node to notify'
    }),
    flags: z.object({
        text: z
            .string({ error: NEEDS_TEXT })
            .min(1, NEEDS_TEXT)
            .max(MAX_NOTICE_LENGTH, {
                error: (issue) =>
                    `--text is ${lengthOf(issue.input)} characters and a message is at most ${MAX_NOTICE_LENGTH}; anything longer belongs in a note on the canvas, which you can link to that node`
            })
            .transform(unescapeText)
    }),
    async run({ positionals: [id], flags }, call) {
        const place = placeOf(call);
        if (id === call.caller) {
            throw new VerbRefusal('self-notify', `${id} is you; a node needs no message to itself`);
        }
        if (place.canvasId === null) {
            throw new VerbRefusal('not-on-a-canvas', 'You are a view of your own, not a node on a canvas, so no line runs from you into anything', [
                'see\truimte-context link\ta line needs both of its ends on one canvas'
            ]);
        }
        const content = await call.host.read(place.projectId);
        const canvas = canvasFor(content, place, undefined);
        /*
         * The rule is the one the canvas already draws: a line from the caller into an agent node is
         * what `deriveContextSources` turns into readable context, so a message may travel exactly
         * where a read already can. An agent cannot poke a node it has no relationship with, and the
         * person who drew the line can see who may reach whom.
         */
        const reachable = canvas.nodes.filter(
            (node) => isAgentKind(node.kind) && canvas.edges.some((edge) => edge.from === call.caller && edge.to === node.id)
        );
        const target = canvas.nodes.find((node) => node.id === id);
        /* Only the nodes this same call would accept, and where there are none, what to do about
           the node that was asked for rather than a sentence about the canvas in general. */
        const lines = (): string[] =>
            orNote(
                reachable.map((node) => `node\t${node.id}\t${node.kind}\t${field(node.title)}`),
                `Nothing on ${canvas.id} has a line from you into it yet; ruimte-context link --to ${id} draws the one this call needs`
            );
        if (!target) {
            throw new VerbRefusal('unknown-node', `${id} is not a node on ${canvas.id}`, lines());
        }
        if (!isAgentKind(target.kind)) {
            throw new VerbRefusal('not-an-agent', `${id} is a ${target.kind} node; only a terminal or a chat has an agent that could read a message`, lines());
        }
        if (!reachable.some((node) => node.id === id)) {
            throw new VerbRefusal(
                'not-linked',
                `${id} is a ${target.kind} node on ${canvas.id}, but no line runs from you into it: draw that line and it can be notified`,
                [...lines(), `see\truimte-context link --to ${id}\tdraws the line this needs`]
            );
        }

        const self = canvas.nodes.find((node) => node.id === call.caller);
        const delivery = await call.host.notify({
            projectId: place.projectId,
            targetId: id,
            from: call.caller,
            fromTitle: field(self?.title ?? ''),
            text: flags.text
        });
        return [`notified\t${id}\t${delivery.at}\t${delivery.detail}`];
    }
});
