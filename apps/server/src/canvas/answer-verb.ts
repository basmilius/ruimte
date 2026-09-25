import { z } from 'zod';
import { defineStandaloneActionVerb, runAction } from './action-verb.ts';
import { unescapeText } from './text-escapes.ts';
import { VerbRefusal } from './verb.ts';

const NEEDS_IDS = 'answer takes the id of the agent that asked and the id of its request';

const ANSWERS_SHAPE = `{"<question id>":"<answer>",...}`;

/* `--answers` as the map `chat.answer` takes, refused by name when it is not one. */
const parseAnswers = (text: string): Record<string, string> => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new VerbRefusal('bad-answers-json', `--answers is not JSON; it takes ${ANSWERS_SHAPE}`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || !Object.values(parsed).every((value) => typeof value === 'string')) {
        throw new VerbRefusal('bad-answers-json', `--answers takes one object of strings, ${ANSWERS_SHAPE}`);
    }
    return parsed as Record<string, string>;
};

export const answerVerb = defineStandaloneActionVerb({
    name: 'answer',
    action: 'agent.answer',
    usage: '<id> <request> --answer T | --answers J',
    params: [
        { syntax: '<id>', need: 'required', field: 'nodeId' },
        { syntax: '<request>', need: 'required', field: 'requestId' },
        { syntax: '--answer T', need: 'optional', field: 'answer', more: '\\n, \\t and \\\\ are read as escapes' },
        { syntax: '--answers J', need: 'optional', field: 'answers', more: `JSON, ${ANSWERS_SHAPE}; not together with --answer` }
    ],
    detail: [
        'prints\tanswered\tid\trequest\tthe agent and the request that no longer wait',
        'who\tOnly an agent you opened yourself, which the machine wrote down outside the project; a line into a node is not enough',
        'find\tThe request id stands in the > Question line ruimte-context read <id> prints, with its question ids and choices under it while it waits, so you can answer in the turn you read it',
        'when\tAn agent with a task of yours that asks something also leaves you a note naming the request; it does not wake you, and you read it at the start of your next turn',
        "what\tOnly a question that still waits. An approval, a login and any other card are a person's alone, and a question a person answered first is refused",
        "same\tYour answer reaches the agent the way a person's does from that node, and the node shows it as answered",
        'refusals\tnot-yours\tself-answer\tunknown-request\tnot-a-question\tnot-pending\tanswer-twice\tanswers-needed\tunknown-question\tempty-answer\tbad-answers-json\tthe whole set this verb refuses with',
        'ids\tOnly ids, never titles; the note about the question names both'
    ],
    positionals: z.tuple([z.string({ error: NEEDS_IDS }).min(1, NEEDS_IDS), z.string({ error: NEEDS_IDS }).min(1, NEEDS_IDS)], {
        error: (issue) => (issue.code === 'too_big' ? 'answer takes two ids and nothing else; the answer goes in --answer' : NEEDS_IDS)
    }),
    flags: z.object({
        answer: z.string().optional(),
        answers: z.string().min(1, '--answers needs a JSON object').optional()
    }),
    async run({ positionals: [id, request], flags }, call) {
        const answered = await runAction(call, 'agent.answer', {
            nodeId: id,
            requestId: request,
            answer: flags.answer === undefined ? null : unescapeText(flags.answer),
            answers: flags.answers === undefined ? null : parseAnswers(flags.answers)
        });
        return [`answered\t${answered.nodeId}\t${answered.requestId}`];
    }
});
