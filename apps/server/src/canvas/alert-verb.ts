import { z } from 'zod';
import { defineStandaloneActionVerb, runAction } from './action-verb.ts';
import { unescapeText } from './text-escapes.ts';

export const alertVerb = defineStandaloneActionVerb({
    name: 'alert',
    action: 'agent.alert',
    usage: '--text "..."',
    params: [{ syntax: '--text M', need: 'required', field: 'text', more: 'at most 500 characters; --text - reads stdin' }],
    detail: [
        'when\tOnly when the person asked for a notification, such as "notify me when you are done"; call it once at that moment',
        'where\tThe notification opens your own session and respects the device notification settings',
        'prints\talerted\tid\tThe notification was queued; this does not confirm delivery to a device',
        'see\truimte-context notify <id> --text "..."\tsends a message to another agent'
    ],
    positionals: z.tuple([]),
    flags: z.object({ text: z.string().transform(unescapeText).pipe(z.string().trim().min(1).max(500)) }),
    async run({ flags }, call) {
        const result = await runAction(call, 'agent.alert', { text: flags.text });
        return [`alerted\t${result.nodeId}`];
    }
});
