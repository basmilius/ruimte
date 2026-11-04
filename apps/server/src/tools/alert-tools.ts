import { z } from 'zod';
import { defineActionTool, runAction } from './action-tool.ts';
import { lengthOf } from './host.ts';
import { defineToolkit } from './tool.ts';

const MAX_ALERT_LENGTH = 500;

const NEEDS_TEXT = 'alert needs text, what the notification says';

const alert = defineActionTool('alert', {
    name: 'alert',
    action: 'agent.alert',
    description: 'Notifies the person, only when they asked for it.',
    input: z.object({
        text: z
            .string({ error: NEEDS_TEXT })
            .trim()
            .min(1, NEEDS_TEXT)
            .max(MAX_ALERT_LENGTH, { error: (issue) => `text is ${lengthOf(issue.input)} characters and a notification is at most ${MAX_ALERT_LENGTH}` })
    }),
    async run(input, call) {
        const result = await runAction(call, 'agent.alert', { text: input.text });

        return [`alerted\t${result.nodeId}`];
    }
});

export const alertToolkit = defineToolkit('alert', [alert]);
