import { TEMPLATE_LANGUAGES, TEMPLATE_LIMITS, TEMPLATE_PLACES } from '@ruimte/contracts';
import { z } from 'zod';
import { ToolRefusal } from '@adecore/agents/context';
import { defineActionTool, jsonLines, runAction } from './action-tool.ts';
import { defineToolkit } from './tool.ts';
import { field, orNote } from './host.ts';

/* Words separated by commas, each one of `known`, without the repeats. */
function listInput<Value extends string>(name: string, known: readonly Value[]) {
    return z
        .string()
        .min(1, `${name} needs a value, one of ${known.join(', ')}`)
        .transform((text) => [...new Set(text.split(',').map((word) => word.trim()))])
        .refine(
            (words): words is Value[] => words.every((word) => (known as readonly string[]).includes(word)),
            `${name} takes ${known.join(', ')}, separated by commas`
        );
}

const templateList = defineActionTool('template', {
    name: 'template_list',
    action: 'template.list',
    description: 'Lists the live and postfix templates of this project.',
    annotations: { readOnly: true },
    input: z.object({
        language: z.enum(TEMPLATE_LANGUAGES, { error: `language takes one of ${TEMPLATE_LANGUAGES.join(', ')}` }).optional(),
        json: z.boolean().optional()
    }),
    async run(input, call) {
        const answer = await runAction(call, 'template.list', { language: input.language ?? null });

        if (input.json === true) {
            return jsonLines(answer);
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

const BODY_NEEDS = 'template_new needs body, the text to insert';

const templateNew = defineActionTool('template', {
    name: 'template_new',
    action: 'template.add',
    description: "Adds a template to the person's own set.",
    input: z.object({
        key: z
            .string({ error: 'template_new needs key, what the person types' })
            .trim()
            .min(1, 'template_new needs key, what the person types')
            .max(TEMPLATE_LIMITS.key, `key is at most ${TEMPLATE_LIMITS.key} characters`)
            .describe('What the person types'),
        body: z.string({ error: BODY_NEEDS }).min(1, BODY_NEEDS).describe('Snippet syntax: $0 and ${1:name} are stops, $EXPR is the postfix expression'),
        language: listInput('language', TEMPLATE_LANGUAGES).describe('Comma separated'),
        description: z.string().trim().max(TEMPLATE_LIMITS.description, `description is at most ${TEMPLATE_LIMITS.description} characters`).optional(),
        place: listInput('place', TEMPLATE_PLACES).optional().describe('For a live template: code, comment or string'),
        expression: z.enum(['any', 'statement'], { error: 'expression takes any or statement' }).optional(),
        postfix: z.boolean().optional(),
        dry_run: z.boolean().optional()
    }),
    async run(input, call) {
        const postfix = input.postfix === true;
        const dryRun = input.dry_run === true;

        if (!postfix && input.expression !== undefined) {
            throw new ToolRefusal('template-invalid', 'expression belongs to a postfix template; set postfix');
        }

        if (postfix && input.place !== undefined) {
            throw new ToolRefusal('template-invalid', 'place belongs to a live template; a postfix template has no place');
        }

        const added = await runAction(
            call,
            'template.add',
            {
                kind: postfix ? 'postfix' : 'live',
                key: input.key,
                body: input.body,
                languages: input.language,
                description: input.description ?? null,
                places: input.place ?? null,
                expression: input.expression ?? null
            },
            dryRun
        );

        return [[dryRun ? 'dry-run' : 'added', dryRun ? '-' : field(added.id), added.kind, field(added.key)].join('\t')];
    }
});

export const templateToolkit = defineToolkit('template', [templateList, templateNew]);
