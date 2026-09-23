import type { ActionOutput } from '@ruimte/actions';
import { PLAN_LIMITS, PlanChecksSchema, PlanKindSchema, PlanStepStateSchema, type PlanItem } from '@ruimte/contracts';
import {
    PLAN_LEGEND,
    PlanDraftMetaSchema,
    PlanDraftSectionSchema,
    PlanDraftStepSchema,
    PlanDraftTextSchema,
    activeStepIds,
    allSteps,
    isParentStep,
    progressText,
    renderPlanText
} from '@ruimte/plan';
import { z } from 'zod';
import { defineActionVerb, runAction } from './action-verb.ts';
import { fieldLines } from './diagram-verb.ts';
import { unescapeText } from './text-escapes.ts';
import { defineNoun, field } from './verb.ts';

/* Agents repeat ids to people, who only know a plan and its steps by their titles. */
const IDS_LINE = 'ids\tIds are for your commands. When you talk to the person, name the plan and its steps by their title, never by id';

const META_FIELDS: Record<keyof typeof PlanDraftMetaSchema.shape, string> = {
    title: 'What the plan is called; --title wins over it, and one of the two is required',
    kind: 'steps for progress you keep, test for a test plan a person runs; steps when absent, and --kind wins',
    summary: 'A short Markdown paragraph under the title about what the plan is for, never its progress',
    status: 'One short sentence about what happens now or next, such as Fixing the focus bug in the grid; never counts or progress, since the panel shows those, and absent rather than a repeat of the title or summary; plan status changes it later',
    checks: 'Who sets a step that names no checks of its own: anyone, agent (a person unlocks it) or person; anyone when absent, and --checks wins'
};

const STEP_FIELDS: Record<keyof typeof PlanDraftStepSchema.shape, string> = {
    type: 'Says the item is a step',
    id: `Lowercase letters, digits and dashes, at most ${PLAN_LIMITS.idLength}, unique in the plan; minted when absent, and a slug you pick reads easier later`,
    title: `One line, at most ${PLAN_LIMITS.title} characters`,
    description: `Short Markdown without headings, at most ${PLAN_LIMITS.description} characters`,
    checks: 'Who sets this step: anyone, agent or person; the plan checks when absent',
    state: 'Only on a step without sub-steps, and never on a step only a person checks; open when absent',
    note: `Why it failed, which commit, what was seen; at most ${PLAN_LIMITS.note} characters`,
    steps: `Sub-steps, up to ${PLAN_LIMITS.depth} levels deep; a step with sub-steps takes its state from them`
};

const TEXT_FIELDS: Record<keyof typeof PlanDraftTextSchema.shape, string> = {
    type: 'Says the item is a text block',
    id: 'As for a step',
    title: 'The bold line of the block',
    description: 'What a person reads before the steps under it'
};

const SECTION_FIELDS: Record<keyof typeof PlanDraftSectionSchema.shape, string> = {
    type: 'Says the item is a section',
    id: 'As for a step',
    title: 'The heading of the section',
    description: 'A paragraph under the heading',
    items: 'Text blocks and steps; a section never holds a section'
};

/* A document that passes, so an agent has one shape to start from; a test holds it to the schema. */
export const PLAN_EXAMPLE = JSON.stringify({
    meta: { title: 'Test the split placement', kind: 'test', checks: 'person' },
    items: [
        {
            type: 'section',
            id: 'split',
            title: 'Splitting a cell',
            items: [
                { type: 'text', title: 'Before you start', description: 'Close every split so the project shows one cell.' },
                { type: 'step', id: 'new-column', title: 'Dragging a view right makes a new column' },
                {
                    type: 'step',
                    id: 'full-grid',
                    title: 'A full grid refuses a fourth column',
                    steps: [{ type: 'step', id: 'no-zone', title: 'No drop zone on the edge' }]
                }
            ]
        }
    ]
});

const PLAN_FLAG = { syntax: '--plan P', need: 'optional', field: 'planId' } as const;

const REFUSAL_CODES = [
    'refusals',
    'plan-needs-chat',
    'plan-not-found',
    'plan-missing-item',
    'person-only',
    'set-by-person',
    'unlocked-by-person',
    'too-many-plans',
    'plan-invalid',
    'the codes these verbs refuse with most'
].join('\t');

/* What every change prints: the plan and its rev, the steps now active, and states a new sub-step took away. */
const changedLines = ({ plan, dropped }: ActionOutput<'plan.addNote'>): string[] => {
    const active = activeStepIds(plan);
    return [
        `plan\t${plan.id}\trev ${plan.rev}\t${plan.meta.kind}\t${field(plan.meta.title)}\t${field(progressText(plan))}`,
        ...(active.length > 0 ? [`now\t${active.join('\t')}`] : []),
        ...dropped.map((id) => `dropped\t${id}\tgot its first sub-step, so its own state is gone and follows from its sub-steps`)
    ];
};

/* Every item with the id it has, the item it stands under, its kind and title, in document order. */
const itemLines = (items: readonly PlanItem[], under = '-'): string[] =>
    items.flatMap((item) => [
        `item\t${item.id}\t${item.type}\t${under}\t${field(item.title)}`,
        ...itemLines(item.type === 'section' ? item.items : item.type === 'step' ? (item.steps ?? []) : [], item.id)
    ]);

const planFlag = z.string().min(1, '--plan needs the id of a plan; ruimte-context plan read --all lists them').optional();
const itemId = (verb: string, what = 'an item'): z.ZodTuple =>
    z.tuple([z.string().min(1, `${verb} needs the id of ${what}`)], {
        error: (issue) => (issue.code === 'too_big' ? `${verb} takes one id; everything else is a flag` : `${verb} needs the id of ${what}`)
    });
const stateFlag = z.enum(PlanStepStateSchema.options, { error: `--state takes one of ${PlanStepStateSchema.options.join(', ')}` });
const checksFlag = z.enum(PlanChecksSchema.options, { error: `--checks takes one of ${PlanChecksSchema.options.join(', ')}` }).optional();
const textFlag = (needs: string) => z.string({ error: needs });

const ITEM_ID = { syntax: '<itemId>', need: 'required', field: 'itemId' } as const;

const newSub = defineActionVerb('plan', {
    name: 'new',
    action: 'plan.create',
    usage: '[--title T] [--kind steps|test] [--checks anyone|agent|person] [--dry-run] (< plan.json | --markdown -)',
    params: [
        {
            syntax: '--markdown -',
            need: 'optional',
            field: 'markdown',
            text: 'A GFM task list on stdin instead of JSON: # title, ## section, - [ ] step, indented for a sub-step, > **Title** description for a text block, [x] [!] [-] [?] [~] [w] [i] for a state'
        },
        {
            syntax: '--document JSON',
            need: 'optional',
            field: 'document',
            text: 'The JSON as one argument instead of on stdin; the CLI puts stdin here when you give neither'
        },
        { syntax: '--title T', need: 'optional', field: 'title' },
        { syntax: '--kind K', need: 'optional', field: 'kind', text: `${PlanKindSchema.options.join(' or ')}, over the one in the document` },
        {
            syntax: '--checks C',
            need: 'optional',
            field: 'checks',
            text: `Who sets the steps that name no checks: ${PlanChecksSchema.options.join(', ')}; over the one in the document`
        },
        { syntax: '--dry-run', need: 'optional', text: 'The same checks, nothing written; minted ids differ from the ones a real run mints' }
    ],
    detail: [
        "stdin\tThe plan as JSON, piped in or as a heredoc: ruimte-context plan new <<'EOF' ... EOF",
        'prints\tplan\tid\trev 0\tkind\ttitle\tthe plan made; dry-run instead of plan with --dry-run',
        'prints\titem\tid\ttype\tunder\ttitle\tone line per item in document order; under is the section or step it stands in, - at the top',
        'prints\texample\ta command that checks off the first step',
        'prints\tids\ta reminder that ids are for commands, never for the person',
        "document\t{ meta, items }\tone JSON object; by and at are the daemon's and cannot be written",
        ...fieldLines('meta.', PlanDraftMetaSchema.shape, META_FIELDS),
        ...fieldLines('items[] step.', PlanDraftStepSchema.shape, STEP_FIELDS),
        ...fieldLines('items[] text.', PlanDraftTextSchema.shape, TEXT_FIELDS),
        ...fieldLines('items[] section.', PlanDraftSectionSchema.shape, SECTION_FIELDS),
        'strict\tA field that is not listed here is refused by its path, never dropped',
        `limits\tAt most ${PLAN_LIMITS.items} items, steps ${PLAN_LIMITS.depth} levels deep, ${PLAN_LIMITS.plansPerChat} plans per chat`,
        `example\t${PLAN_EXAMPLE}`
    ],
    positionals: z.tuple([], { error: 'plan new takes no arguments; the plan goes on stdin' }),
    flags: z.object({
        document: z.string().optional(),
        markdown: z.string().optional(),
        title: z
            .string()
            .min(1, '--title needs the title of the plan')
            .max(PLAN_LIMITS.title, `--title fits at most ${PLAN_LIMITS.title} characters`)
            .optional(),
        kind: z.enum(PlanKindSchema.options, { error: `--kind takes one of ${PlanKindSchema.options.join(', ')}` }).optional(),
        checks: checksFlag
    }),
    dryRun: true,
    async run({ flags, dryRun }, call) {
        const { plan } = await runAction(
            call,
            'plan.create',
            {
                document: flags.document ?? null,
                markdown: flags.markdown ?? null,
                title: flags.title ?? null,
                kind: flags.kind ?? null,
                checks: flags.checks ?? null
            },
            dryRun
        );
        const firstStep = allSteps(plan.items).find((step) => !isParentStep(step));
        return [
            `${dryRun ? 'dry-run' : 'plan'}\t${plan.id}\trev ${plan.rev}\t${plan.meta.kind}\t${field(plan.meta.title)}`,
            ...itemLines(plan.items),
            firstStep
                ? `example\truimte-context plan set ${firstStep.id} --state done`
                : 'example\truimte-context plan add --type step --title "The first step"',
            IDS_LINE,
            ...(dryRun ? ['note\tNothing was written; run it again without --dry-run to make the plan'] : [])
        ];
    }
});

const readSub = defineActionVerb('plan', {
    name: 'read',
    action: 'plan.read',
    usage: '[--plan P] [--all]',
    params: [PLAN_FLAG, { syntax: '--all', need: 'optional', text: 'Every plan of this chat, oldest first' }],
    detail: [
        'prints\tA plan as text: a line with title, id, kind, rev and progress, a line with summary, status, the active steps and the other plans, then one line per item, with the description of a step or a section on the line under it',
        `legend\t${PLAN_LEGEND}`,
        'marks\tperson-only and agent-only say who sets a step; set by a person means you leave its state alone'
    ],
    positionals: z.tuple([], { error: 'plan read takes no arguments; --plan names a plan' }),
    flags: z.object({ plan: planFlag }),
    switches: ['all'],
    async run({ flags, switches }, call) {
        const NO_PLAN = 'note\tThis chat has no plan; ruimte-context plan new makes one';
        if (switches.has('all')) {
            const { plans } = await runAction(call, 'plan.list', {});
            if (plans.length === 0) {
                return [NO_PLAN];
            }
            return plans.flatMap((plan, index) => [...(index === 0 ? [] : ['']), ...renderPlanText(plan).split('\n')]);
        }
        const { plan, others } = await runAction(call, 'plan.read', { planId: flags.plan ?? null });
        if (plan === null) {
            return [NO_PLAN];
        }
        return renderPlanText(plan, { others }).split('\n');
    }
});

const setSub = defineActionVerb('plan', {
    name: 'set',
    action: 'plan.setStepState',
    usage: '<stepId>... --state open|active|done|failed|skipped|blocked|warning|info [--note T] [--next ID] [--plan P]',
    params: [
        { syntax: '<stepId>...', need: 'required', field: 'stepIds' },
        {
            syntax: '--state S',
            need: 'required',
            field: 'state',
            text: `${PlanStepStateSchema.options.join(', ')}; active is the step you work on now, and more than one may be; warning ran with a concern and info ran with something worth reading, both with a --note that says what`
        },
        { syntax: '--note T', need: 'optional', field: 'note', more: '\\n reads as a newline' },
        {
            syntax: '--next ID',
            need: 'optional',
            field: 'next',
            text: 'The step that becomes active in the same rev: plan set build --state done --next tests'
        },
        PLAN_FLAG
    ],
    detail: [
        'prints\tplan\tid\trev N\tkind\ttitle\tprogress, then now\tthe active steps, and a dropped line for a state a change took away',
        'who\tA person-only step is never yours to set, and a state a person set stays; a note is always yours to add'
    ],
    positionals: z.array(z.string().min(1, 'a step id may not be empty')).min(1, 'plan set needs the id of at least one step'),
    flags: z.object({ state: stateFlag, note: z.string().optional(), next: z.string().min(1, '--next needs the id of a step').optional(), plan: planFlag }),
    async run({ positionals, flags }, call) {
        return changedLines(
            await runAction(call, 'plan.setStepState', {
                planId: flags.plan ?? null,
                stepIds: positionals,
                state: flags.state,
                note: flags.note === undefined ? null : unescapeText(flags.note),
                next: flags.next ?? null
            })
        );
    }
});

const noteSub = defineActionVerb('plan', {
    name: 'note',
    action: 'plan.addNote',
    usage: '<stepId> --text T [--plan P]',
    params: [
        { syntax: '<stepId>', need: 'required', field: 'stepId' },
        {
            syntax: '--text T',
            need: 'required',
            field: 'text',
            text: `At most ${PLAN_LIMITS.note} characters; \\n reads as a newline, and --text - takes it from stdin`
        },
        PLAN_FLAG
    ],
    detail: ['prints\tplan\tid\trev N\tkind\ttitle\tprogress'],
    positionals: itemId('plan note', 'a step'),
    flags: z.object({ text: textFlag('plan note needs --text with the note, or an empty one to clear it'), plan: planFlag }),
    async run({ positionals: [id], flags }, call) {
        return changedLines(await runAction(call, 'plan.addNote', { planId: flags.plan ?? null, stepId: id as string, text: unescapeText(flags.text) }));
    }
});

const addSub = defineActionVerb('plan', {
    name: 'add',
    action: 'plan.addItem',
    usage: '--type step|text|section --title T [--description D] [--under ID] [--after ID] [--checks anyone|agent|person] [--id ID] [--plan P]',
    params: [
        { syntax: '--type T', need: 'required', field: 'type' },
        { syntax: '--title T', need: 'required', field: 'title', text: `One line, at most ${PLAN_LIMITS.title} characters` },
        { syntax: '--description D', need: 'optional', field: 'description', more: '\\n reads as a newline' },
        {
            syntax: '--under ID',
            need: 'optional',
            field: 'under',
            more: 'a step under a leaf makes that leaf a parent and drops its own state'
        },
        {
            syntax: '--after ID',
            need: 'optional',
            field: 'after',
            text: 'The item it goes right after, beside it; with --under it has to stand directly under that item'
        },
        { syntax: '--checks C', need: 'optional', field: 'checks' },
        { syntax: '--id ID', need: 'optional', field: 'itemId' },
        PLAN_FLAG
    ],
    detail: [
        'place\tWithout --under and --after the item goes last at the top of the plan; a section only stands at the top',
        'prints\tplan\tid\trev N\tkind\ttitle\tprogress, then added\tid\ttype'
    ],
    positionals: z.tuple([], { error: 'plan add takes no arguments, only flags' }),
    flags: z.object({
        type: z.enum(['step', 'text', 'section'], { error: '--type takes step, text or section' }),
        title: z.string({ error: 'plan add needs --title' }).min(1, 'plan add needs --title'),
        description: z.string().optional(),
        under: z.string().min(1, '--under needs the id of a section or step').optional(),
        after: z.string().min(1, '--after needs the id of an item').optional(),
        checks: checksFlag,
        id: z.string().min(1, '--id needs an id').optional(),
        plan: planFlag
    }),
    async run({ flags }, call) {
        const added = await runAction(call, 'plan.addItem', {
            planId: flags.plan ?? null,
            type: flags.type,
            title: flags.title,
            description: flags.description === undefined ? null : unescapeText(flags.description),
            under: flags.under ?? null,
            after: flags.after ?? null,
            checks: flags.checks ?? null,
            itemId: flags.id ?? null
        });
        return [...changedLines(added), `added\t${added.itemId}\t${flags.type}`];
    }
});

const editSub = defineActionVerb('plan', {
    name: 'edit',
    action: 'plan.editItem',
    usage: '<itemId> [--title T] [--description D] [--checks anyone|agent|person] [--plan P]',
    params: [
        ITEM_ID,
        { syntax: '--title T', need: 'optional', field: 'title' },
        { syntax: '--description D', need: 'optional', field: 'description' },
        {
            syntax: '--checks C',
            need: 'optional',
            field: 'checks',
            more: 'a step a person unlocked stays anyone, and a person-only step stays person-only'
        },
        PLAN_FLAG
    ],
    detail: ['prints\tplan\tid\trev N\tkind\ttitle\tprogress'],
    positionals: itemId('plan edit'),
    flags: z.object({
        title: z.string().min(1, '--title may not be empty').optional(),
        description: z.string().optional(),
        checks: checksFlag,
        plan: planFlag
    }),
    async run({ positionals: [id], flags }, call) {
        return changedLines(
            await runAction(call, 'plan.editItem', {
                planId: flags.plan ?? null,
                itemId: id as string,
                title: flags.title ?? null,
                description: flags.description === undefined ? null : unescapeText(flags.description),
                checks: flags.checks ?? null
            })
        );
    }
});

const moveSub = defineActionVerb('plan', {
    name: 'move',
    action: 'plan.moveItem',
    usage: '<itemId> [--under ID] [--after ID] [--plan P]',
    params: [ITEM_ID, { syntax: '--under ID', need: 'optional', field: 'under' }, { syntax: '--after ID', need: 'optional', field: 'after' }, PLAN_FLAG],
    detail: ['place\tWithout either it goes last at the top of the plan', 'prints\tplan\tid\trev N\tkind\ttitle\tprogress'],
    positionals: itemId('plan move'),
    flags: z.object({
        under: z.string().min(1, '--under needs the id of a section or step').optional(),
        after: z.string().min(1, '--after needs the id of an item').optional(),
        plan: planFlag
    }),
    async run({ positionals: [id], flags }, call) {
        return changedLines(
            await runAction(call, 'plan.moveItem', { planId: flags.plan ?? null, itemId: id as string, under: flags.under ?? null, after: flags.after ?? null })
        );
    }
});

const removeSub = defineActionVerb('plan', {
    name: 'remove',
    action: 'plan.removeItem',
    usage: '<itemId> [--plan P]',
    params: [ITEM_ID, PLAN_FLAG],
    detail: ['prints\tplan\tid\trev N\tkind\ttitle\tprogress'],
    positionals: itemId('plan remove'),
    flags: z.object({ plan: planFlag }),
    async run({ positionals: [id], flags }, call) {
        return changedLines(await runAction(call, 'plan.removeItem', { planId: flags.plan ?? null, itemId: id as string }));
    }
});

const statusSub = defineActionVerb('plan', {
    name: 'status',
    action: 'plan.setStatus',
    usage: '--text T [--plan P]',
    params: [
        {
            syntax: '--text T',
            need: 'required',
            field: 'text',
            text: `One short sentence, at most ${PLAN_LIMITS.status} characters, such as Fixing the focus bug in the grid`
        },
        PLAN_FLAG
    ],
    detail: [
        'never\tNo counts or progress numbers, since the panel shows progress itself; clear the line rather than repeat the title or summary',
        'prints\tplan\tid\trev N\tkind\ttitle\tprogress'
    ],
    positionals: z.tuple([], { error: 'plan status takes no arguments; the line goes in --text' }),
    flags: z.object({ text: textFlag('plan status needs --text with the line, or an empty one to clear it'), plan: planFlag }),
    async run({ flags }, call) {
        return changedLines(await runAction(call, 'plan.setStatus', { planId: flags.plan ?? null, text: unescapeText(flags.text) }));
    }
});

const deleteSub = defineActionVerb('plan', {
    name: 'delete',
    action: 'plan.delete',
    usage: '--plan P',
    params: [{ syntax: '--plan P', need: 'required', field: 'planId' }],
    detail: ['prints\tdeleted\tid\ttitle'],
    positionals: z.tuple([], { error: 'plan delete takes no arguments; --plan names the plan' }),
    flags: z.object({
        plan: z.string({ error: 'plan delete needs --plan with the id of the plan' }).min(1, 'plan delete needs --plan with the id of the plan')
    }),
    async run({ flags }, call) {
        const deleted = await runAction(call, 'plan.delete', { planId: flags.plan });
        return [`deleted\t${deleted.planId}\t${field(deleted.title)}`];
    }
});

export const planVerb = defineNoun({
    name: 'plan',
    summary: 'Keeps a plan beside this chat: steps you check off as you go, or a test plan a person runs; only a chat has plans',
    detail: [
        'about\tA plan belongs to the chat that runs the verb, never to a project; a person sees it in a panel beside the chat, checks steps off, writes notes and unlocks',
        'newest\tWithout --plan every verb works on the newest plan of this chat',
        `legend\t${PLAN_LEGEND}`,
        'active\tMark the step you work on with plan set <id> --state active, and move on with plan set <id> --state done --next <id>',
        'checks\tanyone: you and a person; agent: only you, until a person unlocks it; person: only a person, refused as person-only',
        'person\tA state a person set is never yours to change (set-by-person), and a step a person unlocked stays unlocked (unlocked-by-person)',
        'status\tThe status line is one short sentence about what happens now or next, never counts, since the panel shows progress itself',
        IDS_LINE,
        'compaction\tAfter a compaction you may no longer know the ids: ruimte-context plan read without arguments prints them',
        'others\truimte-context read <chat> on a linked chat shows its plans above the conversation; you never set steps of another chat',
        REFUSAL_CODES
    ],
    actions: [newSub, readSub, setSub, noteSub, addSub, editSub, moveSub, removeSub, statusSub, deleteSub]
});
