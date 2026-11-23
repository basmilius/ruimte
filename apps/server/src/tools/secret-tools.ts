import { SECRET_LIMITS, SECRET_VARIABLE_PATTERN, secretPageUrl } from '@ruimte/contracts';
import { z } from 'zod';
import { field } from '../canvas/host.ts';
import { DECLINED_NOTE, FILE_NOTE } from '../secrets/secret-requests.ts';
import { defineActionTool, runAction } from './action-tool.ts';
import { defineToolkit, textInput } from './tool.ts';

const WAITING_NOTE = "The card stays up. End your turn; the person's answer wakes you.";

const secretRequest = defineActionTool('secret', {
    name: 'secret_request',
    action: 'secret.request',
    description:
        'Asks the person for a secret in a private card, never in the chat. With launch and variable it goes to that launch, unseen by you; without, to private files your commands read for 24 hours, as `cmd "$(cat <file>)"`.',
    audience: 'chat',
    input: z.object({
        launch: textInput('secret_request', 'launch', 256, 'the id or the name of a launch').optional(),
        variable: z.string().optional().describe('The launch variable'),
        label: textInput('secret_request', 'label', SECRET_LIMITS.label, 'what the person is asked for').describe('Card title'),
        reason: textInput('secret_request', 'reason', SECRET_LIMITS.reason, 'what it is for and where to find it'),
        placeholder: z.string().trim().max(SECRET_LIMITS.placeholder, `placeholder is at most ${SECRET_LIMITS.placeholder} characters`).optional(),
        url: z
            .string()
            .trim()
            .max(SECRET_LIMITS.url, `url is at most ${SECRET_LIMITS.url} characters`)
            .refine((value) => secretPageUrl(value) !== null, 'url is an http(s) address')
            .optional()
            .describe('Sign-in or setup page'),
        fields: z
            .array(
                z.object({
                    name: z.string().regex(SECRET_VARIABLE_PATTERN, 'A field name is letters, digits and underscores, not starting with a digit'),
                    label: z.string().trim().min(1),
                    placeholder: z.string().trim().optional(),
                    masked: z.boolean().optional().describe('false for no secret, as a user name')
                })
            )
            .min(2, 'fields asks for at least two values; leave it out for one')
            .max(SECRET_LIMITS.fields, `fields asks for at most ${SECRET_LIMITS.fields} values`)
            .optional()
            .describe('Several values, one file each'),
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
            delivery: null,
            launch: input.launch ?? null,
            variable: input.variable ?? null,
            label: input.label,
            reason: input.reason,
            placeholder: input.placeholder || null,
            url: input.url ?? null,
            fields: input.fields ?? null,
            wait: input.wait ?? null
        });
        const head =
            result.delivery === 'launch'
                ? `request\t${result.requestId}\t${result.outcome}\t${field(result.launchId ?? '')}\t${field(result.name ?? '')}\t${result.variable ?? ''}`
                : `request\t${result.requestId}\t${result.outcome}\tfile`;

        if (result.outcome === 'waiting') {
            return [head, WAITING_NOTE];
        }

        if (result.outcome === 'declined') {
            return [head, DECLINED_NOTE];
        }

        if (result.files.length === 0) {
            return [head];
        }

        return [head, FILE_NOTE, ...result.files.map((file) => `file\t${file.field ?? '-'}\t${file.path}`)];
    }
});

/* Named as the usage counter its calls add to, which the usage report and the client know. */
export const secretToolkit = defineToolkit('secret', [secretRequest]);
