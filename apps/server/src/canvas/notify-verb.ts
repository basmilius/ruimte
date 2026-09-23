import { z } from 'zod';
import { MAX_NOTICE_LENGTH, MAX_NOTICES, NO_REPLY_NOTICE, NOTICE_MAX_AGE_MS } from '../context/notices.ts';
import { defineStandaloneActionVerb, runAction } from './action-verb.ts';
import { unescapeText } from './text-escapes.ts';
import { lengthOf } from './verb.ts';

const NEEDS_TEXT = '--text needs the message to leave, in quotes';

const NOTICE_HOURS = Math.round(NOTICE_MAX_AGE_MS / 3_600_000);

const NOTIFY_DETAIL: readonly string[] = [
    'prints\tnotified\tid\twhen\twhat happened\twhen is now for a message that is acted on as you call, on a screen or in a turn the chat takes on it, and waiting for one that is held until that node takes a turn of its own',
    'who\tOnly a node a line runs from you into, which is the same direction that makes you readable to it; ruimte-context link new draws that line',
    'who\tA link --to that names a terminal or a chat draws both ways at once, two edges and two rows, so one call is enough to be able to notify it and be notified back',
    'terminal\tA shell with no agent in it gets the line on its screen at once, dimmed, the way the linked context is announced',
    'terminal\tAn agent that answers a context hook (Claude Code or Codex) hears it at the start of its next turn; another CLI gets the line on its screen instead',
    'terminal\tA terminal is never given a turn over a message: a turn there means typing into the shell a person types in, which nothing does',
    'terminal\tA screen is as wide as the node is, so a long message is wrapped across lines there; it reaches an agent whole either way',
    'chat\tA chat between turns takes a turn on the message and reads it there, so asking another agent something reaches it without a person prompting that chat',
    'chat\tA chat that is in a turn keeps it: the message is read in front of the next turn that chat takes, as it always was',
    'once\tOne step and no further: a turn a message started wakes nobody, so a message sent from such a turn waits for the next turn of the node it went to, and the answer says so',
    'once\tThat is what keeps two agents reading each other from waking each other on and on, which nothing but a person should be able to set off',
    'waiting\tA node that runs nothing yet keeps the message until it starts',
    `waiting\tAt most ${MAX_NOTICES} messages wait per node, the oldest dropped first, and one nobody picks up in ${NOTICE_HOURS} hours is dropped; each is delivered once`,
    'not\tThis is a message, not a command: nothing is typed into a shell, and what the node does with it is its own call',
    'not\tYou never hear that it was read: the answer says where it went and nothing after that, and waiting means it sits there until that agent takes its next turn',
    `reply\tThere is no reply channel: ${NO_REPLY_NOTICE}. Do not wait on the node you wrote to; it answers only by sending a notify of its own, which needs a line running the other way, and what it did you read with ruimte-context read`,
    'see\truimte-context task new\ta task comes back to you with its result and settles, a message does not: ask with a task when you need the answer, send a message when the other agent needs to know',
    'refusals\tnot-linked\tself-notify\tnot-an-agent\tunknown-node\tnot-on-a-canvas\tthe whole set this verb refuses with',
    'ids\tOnly ids, never titles; ruimte-context node list lists the nodes of a canvas with theirs'
];

export const notifyVerb = defineStandaloneActionVerb({
    name: 'notify',
    action: 'agent.notify',
    usage: '<id> --text "..."',
    params: [
        { syntax: '<id>', need: 'required', field: 'nodeId', more: 'ruimte-context link list lists the lines you have' },
        {
            syntax: '--text M',
            need: 'required',
            field: 'text',
            text: `The message, at most ${MAX_NOTICE_LENGTH} characters; \\n, \\t and \\\\ are read as escapes, and --text - takes it from stdin`
        }
    ],
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
        const delivery = await runAction(call, 'agent.notify', { nodeId: id, text: flags.text });
        return [`notified\t${delivery.nodeId}\t${delivery.at}\t${delivery.detail}`];
    }
});
