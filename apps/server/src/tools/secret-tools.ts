import { SECRET_LIMITS } from '@ruimte/contracts';
import { z } from 'zod';
import { defineActionTool, runAction } from './action-tool.ts';
import { defineToolkit, textInput } from './tool.ts';
import { field } from './host.ts';

const secretRequest = defineActionTool('secret', {
    name: 'secret_request',
    action: 'secret.request',
    description: 'Asks the person in a private card for the secret a launch variable needs. You never see it.',
    audience: 'chat',
    input: z.object({
        launch: textInput('secret_request', 'launch', 256, 'the id or the name of a launch'),
        variable: z.string({ error: 'secret_request needs variable, the name of the environment variable' }).describe('The variable the secret goes in'),
        label: textInput('secret_request', 'label', SECRET_LIMITS.label, 'what the person is asked for').describe('What the person is asked for'),
        reason: textInput('secret_request', 'reason', SECRET_LIMITS.reason, 'why the launch needs it'),
        placeholder: z.string().trim().max(SECRET_LIMITS.placeholder, `placeholder is at most ${SECRET_LIMITS.placeholder} characters`).optional(),
        wait: z
            .number({ error: 'wait takes a whole number of seconds' })
            .int('wait takes a whole number of seconds')
            .min(1, 'wait is between 1 and 110')
            .max(110, 'wait is between 1 and 110')
            .optional()
            .describe('Seconds the call holds for the answer')
    }),
    async run(input, call) {
        const result = await runAction(call, 'secret.request', {
            launch: input.launch,
            variable: input.variable,
            label: input.label,
            reason: input.reason,
            placeholder: input.placeholder || null,
            wait: input.wait ?? null
        });

        return [`request\t${result.requestId}\t${result.outcome}\t${field(result.launchId)}\t${field(result.name)}\t${result.variable}`];
    }
});

/* Named as the usage counter its calls add to, which the usage report and the client know. */
export const secretToolkit = defineToolkit('secret', [secretRequest]);
