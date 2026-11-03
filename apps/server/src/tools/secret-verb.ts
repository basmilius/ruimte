import { SECRET_LIMITS } from '@ruimte/contracts';
import { z } from 'zod';
import { SECRET_CARD_MS } from '../secrets/secret-requests.ts';
import { defineActionVerb, runAction } from './action-verb.ts';
import { SCOPE_LINE, field, textFlag } from './verb.ts';

const requestAction = defineActionVerb('secret', {
    name: 'request',
    action: 'secret.request',
    usage: '--launch <launch> --variable <NAME> --label <text> --reason <text> [--placeholder <text>] [--wait S]',
    params: [
        { syntax: '--launch <launch>', need: 'required', field: 'launch', more: 'launch_list names them; a group has no environment' },
        { syntax: '--variable <NAME>', need: 'required', field: 'variable', more: 'not one starting with RUIMTE_' },
        { syntax: '--label <text>', need: 'required', field: 'label' },
        { syntax: '--reason <text>', need: 'required', field: 'reason' },
        { syntax: '--placeholder <text>', need: 'optional', field: 'placeholder' },
        { syntax: '--wait S', need: 'optional', field: 'wait', more: 'give your shell command a timeout above it, since some CLIs end one after 10 s' }
    ],
    detail: [
        'prints\trequest\tid\toutcome\tlaunch id\tlaunch name\tvariable\twhat became of the card; never the value',
        'outcome\tsaved\tthe person saved a value: the launch gets it as this variable from its next start; restart it if it runs',
        'outcome\tdeclined\tthe person said no: go on without it, or ask in words what they want instead',
        'outcome\twaiting\tthe card still stands: run the same command again to keep waiting, with --wait up to 110',
        'outcome\tcancelled\tthe turn ended or the chat stopped before an answer',
        `outcome\ttimed-out\tnobody answered within ${SECRET_CARD_MS / 60_000} minutes of your last ask`,
        'again\tThe same launch and variable from the same chat is the same card: asking again waits on it, and an answer that came while nobody waited is told once',
        'private\tThe value never reaches you, the chat, the project files or any log: it stays on this machine, and only the process of that launch gets it in its environment',
        'approval\tA person who saves binds the variable on the launch; a launch they had approved stays approved, any other still waits on their yes in the launch chip',
        'never\tNever ask for a secret in a message, a question or a file; never print, log or commit one a launch got',
        SCOPE_LINE
    ],
    positionals: z.tuple([], { error: 'secret request takes no arguments; everything goes in its flags' }),
    flags: z.object({
        launch: textFlag('secret request', 'launch', 256, 'the id or the name of a launch'),
        variable: z.string({ error: 'secret request needs --variable, the name of the environment variable' }),
        label: textFlag('secret request', 'label', SECRET_LIMITS.label, 'what the person is asked for'),
        reason: textFlag('secret request', 'reason', SECRET_LIMITS.reason, 'why the launch needs it'),
        placeholder: z.string().trim().max(SECRET_LIMITS.placeholder, `--placeholder is at most ${SECRET_LIMITS.placeholder} characters`).optional(),
        wait: z
            .string()
            .regex(/^\d+$/, '--wait takes a whole number of seconds')
            .transform(Number)
            .refine((value) => value >= 1 && value <= 110, '--wait is between 1 and 110')
            .optional()
    }),
    async run({ flags }, call) {
        const result = await runAction(call, 'secret.request', {
            launch: flags.launch,
            variable: flags.variable,
            label: flags.label,
            reason: flags.reason,
            placeholder: flags.placeholder || null,
            wait: flags.wait ?? null
        });
        return [`request\t${result.requestId}\t${result.outcome}\t${field(result.launchId)}\t${field(result.name)}\t${result.variable}`];
    }
});

export const SECRET_SUMMARY =
    'Asks the person for a secret a launch needs, such as an API key, in a private card of your chat; the launch gets it as an environment variable and you never see it';

export const SECRET_DETAIL: readonly string[] = [
    'note\tOnly an AI chat asks; the card shows in that chat and in the stack of the canvas until the person saves or declines',
    'note\tA secret is only ever an environment variable of a launch; there is no way to read one back',
    SCOPE_LINE
];

export const SECRET_ACTIONS = [requestAction] as const;
