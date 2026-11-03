import { MAX_NOTICE_LENGTH } from '@ruimte/actions';
import { z } from 'zod';
import { defineActionTool, runAction } from './action-tool.ts';
import { defineToolkit, PROJECT_INPUT } from './tool.ts';
import { lengthOf } from './host.ts';

const NEEDS_ID = 'notify needs id, the terminal or chat node to message';

const NEEDS_TEXT = 'notify needs text, the message to leave';

const notify = defineActionTool('notify', {
    name: 'notify',
    action: 'agent.notify',
    description: 'Messages the agent in a node your line runs into, waking a chat between turns.',
    input: z.object({
        id: z.string({ error: NEEDS_ID }).min(1, NEEDS_ID).describe('A terminal or chat node'),
        project: PROJECT_INPUT,
        text: z
            .string({ error: NEEDS_TEXT })
            .min(1, NEEDS_TEXT)
            .max(MAX_NOTICE_LENGTH, {
                error: (issue) =>
                    `text is ${lengthOf(issue.input)} characters and a message is at most ${MAX_NOTICE_LENGTH}; anything longer belongs in a note on the canvas, which you can link to that node`
            })
    }),
    async run(input, call) {
        const delivery = await runAction(call, 'agent.notify', { nodeId: input.id, text: input.text });

        return [['notified', delivery.nodeId, delivery.at, delivery.detail, ...(delivery.title === undefined ? [] : [delivery.title])].join('\t')];
    }
});

export const notifyToolkit = defineToolkit('notify', [notify]);
