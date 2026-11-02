import { TEMPLATE_LANGUAGES, TEMPLATE_LIMITS, TEMPLATE_PLACES } from '@ruimte/contracts';
import { z } from 'zod';
import { DRY_RUN_PREVIEW, SCOPE_LINE, VerbRefusal, field, orNote, textFlag } from './verb.ts';
import { JSON_PARAM, defineActionVerb, jsonLines as json, runAction } from './action-verb.ts';
import { unescapeText } from '@ruimte/actions/text-escapes';

const REFUSALS = 'template-invalid\ttemplate-key-taken\tno-templates\tthe codes this action refuses with';

function listOf<Value extends string>(flag: string, known: readonly Value[]) {
    return z
        .string()
        .min(1, `--${flag} needs a value, one of ${known.join(', ')}`)
        .transform((text) => [...new Set(text.split(',').map((word) => word.trim()))])
        .refine(
            (words): words is Value[] => words.every((word) => (known as readonly string[]).includes(word)),
            `--${flag} takes ${known.join(', ')}, separated by commas`
        );
}

const listAction = defineActionVerb('template', {
    name: 'list',
    action: 'template.list',
    usage: '[--language L] [--json]',
    params: [{ syntax: '--language L', need: 'optional', field: 'language', more: `one of ${TEMPLATE_LANGUAGES.join(', ')}` }, JSON_PARAM],
    detail: [
        'prints\ttemplate\tid\tlive|postfix\tkey\tlanguages\tbuilt-in|personal|project\tdescription\tone line per template, languages separated by commas, a dash where there is no description',
        'bodies\t--json adds the body of each template, null for a built-in one; read it before you add a template that would sit next to it',
        'enabled\tA built-in template the person switched off is not listed, and its key is free again',
        `refusals\t${REFUSALS}`
    ],
    positionals: z.tuple([]),
    flags: z.object({ language: z.enum(TEMPLATE_LANGUAGES, { error: `--language takes one of ${TEMPLATE_LANGUAGES.join(', ')}` }).optional() }),
    switches: ['json'],
    async run({ flags, switches }, call) {
        const answer = await runAction(call, 'template.list', { language: flags.language ?? null });

        if (switches.has('json')) {
            return json(answer);
        }

        return orNote(
            answer.templates.map((template) =>
                [
                    'template',
                    field(template.id),
                    template.kind,
                    field(template.key),
                    template.languages.join(','),
                    template.source,
                    template.description === null ? '-' : field(template.description)
                ].join('\t')
            ),
            'No template applies'
        );
    }
});

const newAction = defineActionVerb('template', {
    name: 'new',
    action: 'template.add',
    usage: '--key K --body T --language L[,L] [--description T] [--place P[,P]] [--postfix [--expression E]] [--dry-run]',
    dryRun: true,
    params: [
        { syntax: '--key K', need: 'required', field: 'key' },
        { syntax: '--body T', need: 'required', field: 'body', more: `\\n, \\t and \\\\ are read as escapes, at most ${TEMPLATE_LIMITS.body} characters` },
        { syntax: '--language L,M', need: 'required', field: 'languages', more: `one or more of ${TEMPLATE_LANGUAGES.join(', ')}, separated by commas` },
        { syntax: '--description T', need: 'optional', field: 'description' },
        { syntax: '--place P,Q', need: 'live', field: 'places', more: `${TEMPLATE_PLACES.join(', ')}, separated by commas` },
        { syntax: '--postfix', need: 'no value', text: 'Makes a postfix template instead of a live one' },
        { syntax: '--expression E', need: 'postfix', field: 'expression', more: 'any or statement' },
        { syntax: '--dry-run', need: 'no value', text: `Checks everything and writes nothing; ${DRY_RUN_PREVIEW}` }
    ],
    detail: [
        'prints\tadded\tid\tlive|postfix\tkey\tthe template that now exists, or dry-run in the first field and no id',
        'whose\tIt joins the templates of the person on this machine, marked as added by an agent, in Settings, Editor, Templates; it is not written to the project, and no verb edits or removes a template',
        "taken\tA key is refused when an enabled template of the same kind, built-in, the person's or the project's, already has it for one of the same languages; template list shows them",
        `refusals\t${REFUSALS}`,
        'see\ttemplate_list\tthe templates already there'
    ],
    positionals: z.tuple([], { error: 'template new takes no arguments; everything goes in its flags' }),
    flags: z.object({
        key: textFlag('template new', 'key', TEMPLATE_LIMITS.key, 'what the person types'),
        body: z.string({ error: 'template new needs --body, the text to insert' }).min(1, 'template new needs --body, the text to insert'),
        language: listOf('language', TEMPLATE_LANGUAGES),
        description: z.string().trim().max(TEMPLATE_LIMITS.description, `--description is at most ${TEMPLATE_LIMITS.description} characters`).optional(),
        place: listOf('place', TEMPLATE_PLACES).optional(),
        expression: z.enum(['any', 'statement'], { error: '--expression takes any or statement' }).optional()
    }),
    switches: ['postfix'],
    async run({ flags, switches, dryRun }, call) {
        const postfix = switches.has('postfix');

        if (!postfix && flags.expression !== undefined) {
            throw new VerbRefusal('template-invalid', '--expression belongs to a postfix template; add --postfix');
        }

        if (postfix && flags.place !== undefined) {
            throw new VerbRefusal('template-invalid', '--place belongs to a live template; a postfix template has no place');
        }

        const added = await runAction(
            call,
            'template.add',
            {
                kind: postfix ? 'postfix' : 'live',
                key: flags.key,
                body: unescapeText(flags.body),
                languages: flags.language,
                description: flags.description ?? null,
                places: flags.place ?? null,
                expression: flags.expression ?? null
            },
            dryRun
        );

        return [[dryRun ? 'dry-run' : 'added', dryRun ? '-' : field(added.id), added.kind, field(added.key)].join('\t')];
    }
});

export const TEMPLATE_SUMMARY =
    "Lists the editor's live and postfix templates and adds new ones to the person's own set, marked as added by an agent; none is ever edited or removed by a verb";

export const TEMPLATE_DETAIL: readonly string[] = [
    'when\tWhen you notice the person types the same boilerplate often, or a project has a pattern worth a short key: check template list first, then template new',
    "who\tA template runs nothing, it only inserts text, so adding one is safe; changing or removing one would rewrite habits the person relies on, so no verb does, and the project's own templates file is yours to edit with your file tools",
    SCOPE_LINE
];

export const TEMPLATE_ACTIONS = [listAction, newAction] as const;
