import { PLAN_LIMITS, PlanChecksSchema, PlanKindSchema, PlanStepStateSchema, type Plan, type PlanItem, type PlanOp } from '@ruimte/contracts';
import {
    PLAN_LEGEND,
    PlanDraftMetaSchema,
    PlanDraftSectionSchema,
    PlanDraftStepSchema,
    PlanDraftTextSchema,
    activeStepIds,
    allSteps,
    isParentStep,
    parsePlanDraft,
    parsePlanMarkdown,
    progressText,
    renderPlanText,
    type PlanApplied,
    type PlanRefusal
} from '@ruimte/plan';
import { z } from 'zod';
import { fieldLines } from './diagram-verb.ts';
import { callerKind } from './task-verbs.ts';
import { unescapeText } from './text-escapes.ts';
import { VerbRefusal, defineSubVerb, defineVerbGroup, field, orNote, placeOf, type VerbCall } from './verb.ts';

const HELP_LINE = 'detail\truimte-context help plan';

const META_FIELDS: Record<keyof typeof PlanDraftMetaSchema.shape, string> = {
    title: 'What the plan is called; --title wins over it, and one of the two is required',
    kind: 'steps for progress you keep, test for a test plan a person runs; steps when absent, and --kind wins',
    summary: 'A short Markdown paragraph under the title',
    status: 'One line under the title about where the work stands; plan status changes it later',
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

const PLAN_FLAG = 'flag\t--plan P\toptional\tThe plan by id; without it the newest plan of this chat';

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

/* The chat the caller is: a plan is kept beside a chat's record, and a terminal has none. */
const callerChat = async (call: VerbCall): Promise<string> => {
    const place = placeOf(call);
    const kind = callerKind(await call.host.read(place.projectId), call.caller);
    if (kind !== 'chat') {
        throw new VerbRefusal(
            'plan-needs-chat',
            `A plan belongs to a chat, and you are ${kind === null ? 'not a node of this project' : `a ${kind}`}: only a chat has a record to keep a plan beside`
        );
    }
    return call.caller;
};

const planRow = (plan: Plan): string => `plan\t${plan.id}\t${plan.meta.kind}\t${field(plan.meta.title)}\t${field(progressText(plan))}`;

const plansOrNote = (plans: readonly Plan[]): string[] => orNote(plans.map(planRow), 'This chat has no plan; ruimte-context plan new makes one');

/* A refusal of the store, with what the agent can do next beside it. */
const refused = async (call: VerbCall, chatId: string, refusal: PlanRefusal): Promise<VerbRefusal> => {
    switch (refusal.code) {
        case 'plan-not-found':
            return new VerbRefusal(refusal.code, refusal.message, plansOrNote(await call.host.plans.read(chatId)));
        case 'too-many-plans':
            return new VerbRefusal(refusal.code, refusal.message, [
                ...(await call.host.plans.read(chatId)).map(planRow),
                'see\truimte-context plan delete --plan P\tremoves a plan you no longer keep'
            ]);
        case 'plan-missing-item':
        case 'plan-not-a-step':
        case 'plan-parent-state':
            return new VerbRefusal(refusal.code, refusal.message, ['see\truimte-context plan read\tevery item with its id in brackets']);
        case 'set-by-person':
            return new VerbRefusal(refusal.code, refusal.message, [
                'see\truimte-context plan note <stepId> --text T\ta note is always yours to add; or ask the person in the chat'
            ]);
        case 'plan-invalid':
            return new VerbRefusal(refusal.code, refusal.message, [HELP_LINE]);
        default:
            return new VerbRefusal(refusal.code, refusal.message);
    }
};

/* What every change prints: the plan and its rev, the steps now active, and states a new sub-step took away. */
const changedLines = (applied: PlanApplied): string[] => {
    const active = activeStepIds(applied.plan);
    return [
        `plan\t${applied.plan.id}\trev ${applied.plan.rev}\t${applied.plan.meta.kind}\t${field(applied.plan.meta.title)}\t${field(progressText(applied.plan))}`,
        ...(active.length > 0 ? [`now\t${active.join('\t')}`] : []),
        ...applied.dropped.map((id) => `dropped\t${id}\tgot its first sub-step, so its own state is gone and follows from its sub-steps`)
    ];
};

/* Runs operations of the agent on its own plan and prints the result, or refuses with what to do instead. */
const applyAgentOps = async (call: VerbCall, planId: string | undefined, ops: PlanOp[]): Promise<{ chatId: string; applied: PlanApplied }> => {
    const chatId = await callerChat(call);
    const applied = await call.host.plans.apply(chatId, planId, ops, 'agent');
    if (!applied.ok) {
        throw await refused(call, chatId, applied);
    }
    return { chatId, applied };
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

const parseJson = (source: string): unknown => {
    try {
        return JSON.parse(source);
    } catch (e) {
        throw new VerbRefusal('bad-json', `The document is not JSON: ${e instanceof Error ? e.message : 'it does not parse'}`, [HELP_LINE]);
    }
};

const newSub = defineSubVerb('plan', {
    name: 'new',
    usage: '[--title T] [--kind steps|test] [--checks anyone|agent|person] [--dry-run] (< plan.json | --markdown -)',
    summary: 'Makes a plan for this chat from a JSON document on stdin or a Markdown task list; prints the plan, every item id and how to check one off',
    detail: [
        "stdin\tThe plan as JSON, piped in or as a heredoc: ruimte-context plan new <<'EOF' ... EOF",
        'flag\t--markdown -\toptional\tA GFM task list on stdin instead of JSON: # title, ## section, - [ ] step, indented for a sub-step, > **Title** description for a text block, [x] [!] [-] [?] [~] for a state',
        'flag\t--document JSON\toptional\tThe JSON as one argument instead of on stdin; the CLI puts stdin here when you give neither',
        'flag\t--title T\toptional\tThe title, over the one in the document',
        `flag\t--kind K\toptional\t${PlanKindSchema.options.join(' or ')}, over the one in the document`,
        `flag\t--checks C\toptional\tWho sets the steps that name no checks: ${PlanChecksSchema.options.join(', ')}; over the one in the document`,
        'flag\t--dry-run\toptional\tThe same checks, nothing written; minted ids differ from the ones a real run mints',
        'prints\tplan\tid\trev 0\tkind\ttitle\tthe plan made; dry run instead of plan with --dry-run',
        'prints\titem\tid\ttype\tunder\ttitle\tone line per item in document order; under is the section or step it stands in, - at the top',
        'prints\texample\ta command that checks off the first step',
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
        const chatId = await callerChat(call);
        if (flags.document !== undefined && flags.markdown !== undefined) {
            throw new VerbRefusal('two-documents', 'plan new takes the JSON document or --markdown, not both', [HELP_LINE]);
        }
        const source = flags.markdown ?? flags.document ?? '';
        if (source.trim() === '') {
            throw new VerbRefusal(
                'no-document',
                "plan new reads the plan on stdin and got nothing: ruimte-context plan new <<'EOF' {...} EOF, or ruimte-context plan new --markdown - <<'EOF' ... EOF",
                [HELP_LINE]
            );
        }
        const parsed = flags.markdown === undefined ? parsePlanDraft(parseJson(source)) : parsePlanMarkdown(source);
        if (!parsed.ok) {
            throw await refused(call, chatId, parsed);
        }
        const meta = {
            ...(flags.title ? { title: flags.title } : {}),
            ...(flags.kind ? { kind: flags.kind } : {}),
            ...(flags.checks ? { checks: flags.checks } : {})
        };
        const created = await call.host.plans.create(chatId, { draft: parsed.draft, meta, dryRun });
        if (!created.ok) {
            throw await refused(call, chatId, created);
        }
        const { plan } = created;
        const firstStep = allSteps(plan.items).find((step) => !isParentStep(step));
        return [
            `${dryRun ? 'dry run' : 'plan'}\t${plan.id}\trev ${plan.rev}\t${plan.meta.kind}\t${field(plan.meta.title)}`,
            ...itemLines(plan.items),
            firstStep
                ? `example\truimte-context plan set ${firstStep.id} --state done`
                : 'example\truimte-context plan add --type step --title "The first step"',
            ...(dryRun ? ['note\tNothing was written; run it again without --dry-run to make the plan'] : [])
        ];
    }
});

const readSub = defineSubVerb('plan', {
    name: 'read',
    usage: '[--plan P] [--all]',
    summary: 'Prints the newest plan of this chat as text, with every id in brackets; after a compaction this is how you find the ids again',
    detail: [
        PLAN_FLAG,
        'flag\t--all\toptional\tEvery plan of this chat, oldest first',
        'prints\tA plan as text: a line with title, id, kind, rev and progress, a line with status, the active steps and the other plans, then one line per item',
        `legend\t${PLAN_LEGEND}`,
        'marks\tperson-only and agent-only say who sets a step; set by a person means you leave its state alone'
    ],
    positionals: z.tuple([], { error: 'plan read takes no arguments; --plan names a plan' }),
    flags: z.object({ plan: planFlag }),
    switches: ['all'],
    async run({ flags, switches }, call) {
        const chatId = await callerChat(call);
        const plans = await call.host.plans.read(chatId);
        if (plans.length === 0) {
            return ['note\tThis chat has no plan; ruimte-context plan new makes one'];
        }
        if (switches.has('all')) {
            return plans.flatMap((plan, index) => [...(index === 0 ? [] : ['']), ...renderPlanText(plan).split('\n')]);
        }
        const plan = flags.plan === undefined ? plans.at(-1)! : plans.find((candidate) => candidate.id === flags.plan);
        if (!plan) {
            throw new VerbRefusal('plan-not-found', `This chat has no plan ${flags.plan}`, plansOrNote(plans));
        }
        return renderPlanText(plan, { others: plans.filter((other) => other !== plan) }).split('\n');
    }
});

const setSub = defineSubVerb('plan', {
    name: 'set',
    usage: '<stepId>... --state open|active|done|failed|skipped|blocked [--note T] [--next ID] [--plan P]',
    summary: 'Sets the state of one or more steps in one rev; with --next the step you move on to becomes active in the same rev',
    detail: [
        'argument\t<stepId>...\trequired\tOne or more steps without sub-steps, by id',
        `flag\t--state S\trequired\t${PlanStepStateSchema.options.join(', ')}; active is the step you work on now, and more than one may be`,
        'flag\t--note T\toptional\tA note on each of the steps; an empty one clears it; \\n reads as a newline',
        'flag\t--next ID\toptional\tThe step that becomes active in the same rev: plan set build --state done --next tests',
        PLAN_FLAG,
        'prints\tplan\tid\trev N\tkind\ttitle\tprogress, then now\tthe active steps, and a dropped line for a state a change took away',
        'who\tA person-only step is never yours to set, and a state a person set stays; a note is always yours to add'
    ],
    positionals: z.array(z.string().min(1, 'a step id may not be empty')).min(1, 'plan set needs the id of at least one step'),
    flags: z.object({ state: stateFlag, note: z.string().optional(), next: z.string().min(1, '--next needs the id of a step').optional(), plan: planFlag }),
    async run({ positionals, flags }, call) {
        const op: PlanOp = {
            op: 'set',
            ids: positionals,
            state: flags.state,
            ...(flags.note === undefined ? {} : { note: unescapeText(flags.note) }),
            ...(flags.next === undefined ? {} : { next: flags.next })
        };
        return changedLines((await applyAgentOps(call, flags.plan, [op])).applied);
    }
});

const noteSub = defineSubVerb('plan', {
    name: 'note',
    usage: '<stepId> --text T [--plan P]',
    summary: 'Writes the note of a step, also one a person set; an empty text clears it',
    detail: [
        'argument\t<stepId>\trequired\tThe step, by id',
        `flag\t--text T\trequired\tAt most ${PLAN_LIMITS.note} characters; \\n reads as a newline, and --text - takes it from stdin`,
        PLAN_FLAG,
        'prints\tplan\tid\trev N\tkind\ttitle\tprogress'
    ],
    positionals: itemId('plan note', 'a step'),
    flags: z.object({ text: textFlag('plan note needs --text with the note, or an empty one to clear it'), plan: planFlag }),
    async run({ positionals: [id], flags }, call) {
        return changedLines((await applyAgentOps(call, flags.plan, [{ op: 'note', id: id as string, text: unescapeText(flags.text) }])).applied);
    }
});

const addSub = defineSubVerb('plan', {
    name: 'add',
    usage: '--type step|text|section --title T [--description D] [--under ID] [--after ID] [--checks anyone|agent|person] [--id ID] [--plan P]',
    summary: 'Adds a step, text block or section; prints the plan and the id of the new item',
    detail: [
        'flag\t--type T\trequired\tstep, text or section',
        `flag\t--title T\trequired\tOne line, at most ${PLAN_LIMITS.title} characters`,
        'flag\t--description D\toptional\tShort Markdown; \\n reads as a newline',
        'flag\t--under ID\toptional\tThe section or step it goes in, last; a step under a leaf makes that leaf a parent and drops its own state',
        'flag\t--after ID\toptional\tThe item it goes right after, beside it; with --under it has to stand directly under that item',
        'flag\t--checks C\toptional\tWho sets a new step: anyone, agent or person',
        'flag\t--id ID\toptional\tThe id you want, lowercase letters, digits and dashes; minted when absent',
        PLAN_FLAG,
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
        const { applied } = await applyAgentOps(call, flags.plan, [
            {
                op: 'add',
                type: flags.type,
                title: flags.title,
                ...(flags.description === undefined ? {} : { description: unescapeText(flags.description) }),
                ...(flags.under === undefined ? {} : { under: flags.under }),
                ...(flags.after === undefined ? {} : { after: flags.after }),
                ...(flags.checks === undefined ? {} : { checks: flags.checks }),
                ...(flags.id === undefined ? {} : { id: flags.id })
            }
        ]);
        return [...changedLines(applied), `added\t${flags.id ?? applied.minted[0]}\t${flags.type}`];
    }
});

const editSub = defineSubVerb('plan', {
    name: 'edit',
    usage: '<itemId> [--title T] [--description D] [--checks anyone|agent|person] [--plan P]',
    summary: 'Changes the title, description or checks of an item',
    detail: [
        'argument\t<itemId>\trequired\tThe item, by id',
        'flag\t--title T\toptional\tThe new title',
        'flag\t--description D\toptional\tThe new description; an empty one removes it',
        'flag\t--checks C\toptional\tWho sets the step; a step a person unlocked stays anyone, and a person-only step stays person-only',
        PLAN_FLAG,
        'prints\tplan\tid\trev N\tkind\ttitle\tprogress'
    ],
    positionals: itemId('plan edit'),
    flags: z.object({
        title: z.string().min(1, '--title may not be empty').optional(),
        description: z.string().optional(),
        checks: checksFlag,
        plan: planFlag
    }),
    async run({ positionals: [id], flags }, call) {
        if (flags.title === undefined && flags.description === undefined && flags.checks === undefined) {
            throw new VerbRefusal('nothing-to-edit', 'plan edit needs at least one of --title, --description and --checks');
        }
        const op: PlanOp = {
            op: 'edit',
            id: id as string,
            ...(flags.title === undefined ? {} : { title: flags.title }),
            ...(flags.description === undefined ? {} : { description: unescapeText(flags.description) }),
            ...(flags.checks === undefined ? {} : { checks: flags.checks })
        };
        return changedLines((await applyAgentOps(call, flags.plan, [op])).applied);
    }
});

const moveSub = defineSubVerb('plan', {
    name: 'move',
    usage: '<itemId> [--under ID] [--after ID] [--plan P]',
    summary: 'Moves an item, with everything under it, to another place in the plan',
    detail: [
        'argument\t<itemId>\trequired\tThe item, by id',
        'flag\t--under ID\toptional\tThe section or step it goes in, last',
        'flag\t--after ID\toptional\tThe item it goes right after',
        PLAN_FLAG,
        'place\tWithout either it goes last at the top of the plan',
        'prints\tplan\tid\trev N\tkind\ttitle\tprogress'
    ],
    positionals: itemId('plan move'),
    flags: z.object({
        under: z.string().min(1, '--under needs the id of a section or step').optional(),
        after: z.string().min(1, '--after needs the id of an item').optional(),
        plan: planFlag
    }),
    async run({ positionals: [id], flags }, call) {
        const op: PlanOp = {
            op: 'move',
            id: id as string,
            ...(flags.under === undefined ? {} : { under: flags.under }),
            ...(flags.after === undefined ? {} : { after: flags.after })
        };
        return changedLines((await applyAgentOps(call, flags.plan, [op])).applied);
    }
});

const removeSub = defineSubVerb('plan', {
    name: 'remove',
    usage: '<itemId> [--plan P]',
    summary: 'Removes an item and everything under it; refused when a person set a state in it',
    detail: ['argument\t<itemId>\trequired\tThe item, by id', PLAN_FLAG, 'prints\tplan\tid\trev N\tkind\ttitle\tprogress'],
    positionals: itemId('plan remove'),
    flags: z.object({ plan: planFlag }),
    async run({ positionals: [id], flags }, call) {
        return changedLines((await applyAgentOps(call, flags.plan, [{ op: 'remove', id: id as string }])).applied);
    }
});

const statusSub = defineSubVerb('plan', {
    name: 'status',
    usage: '--text T [--plan P]',
    summary: 'Sets the line under the title that says where the work stands; an empty text clears it',
    detail: [`flag\t--text T\trequired\tOne line, at most ${PLAN_LIMITS.status} characters`, PLAN_FLAG, 'prints\tplan\tid\trev N\tkind\ttitle\tprogress'],
    positionals: z.tuple([], { error: 'plan status takes no arguments; the line goes in --text' }),
    flags: z.object({ text: textFlag('plan status needs --text with the line, or an empty one to clear it'), plan: planFlag }),
    async run({ flags }, call) {
        return changedLines((await applyAgentOps(call, flags.plan, [{ op: 'meta', status: unescapeText(flags.text) }])).applied);
    }
});

const deleteSub = defineSubVerb('plan', {
    name: 'delete',
    usage: '--plan P',
    summary: 'Removes a whole plan of this chat',
    detail: ['flag\t--plan P\trequired\tThe plan by id; never the newest by default, since this cannot be undone', 'prints\tdeleted\tid\ttitle'],
    positionals: z.tuple([], { error: 'plan delete takes no arguments; --plan names the plan' }),
    flags: z.object({
        plan: z.string({ error: 'plan delete needs --plan with the id of the plan' }).min(1, 'plan delete needs --plan with the id of the plan')
    }),
    async run({ flags }, call) {
        const chatId = await callerChat(call);
        const deleted = await call.host.plans.delete(chatId, flags.plan);
        if (!deleted.ok) {
            throw await refused(call, chatId, deleted);
        }
        return [`deleted\t${deleted.plan.id}\t${field(deleted.plan.meta.title)}`];
    }
});

export const planVerb = defineVerbGroup({
    name: 'plan',
    summary: 'Keeps a plan beside this chat: steps you check off as you go, or a test plan a person runs; only a chat has plans',
    detail: [
        'about\tA plan belongs to the chat that runs the verb, never to a project; a person sees it in a panel beside the chat, checks steps off, writes notes and unlocks',
        'newest\tWithout --plan every verb works on the newest plan of this chat',
        `legend\t${PLAN_LEGEND}`,
        'active\tMark the step you work on with plan set <id> --state active, and move on with plan set <id> --state done --next <id>',
        'checks\tanyone: you and a person; agent: only you, until a person unlocks it; person: only a person, refused as person-only',
        'person\tA state a person set is never yours to change (set-by-person), and a step a person unlocked stays unlocked (unlocked-by-person)',
        'compaction\tAfter a compaction you may no longer know the ids: ruimte-context plan read without arguments prints them',
        'others\truimte-context read <chat> on a linked chat shows its plans above the conversation; you never set steps of another chat',
        REFUSAL_CODES
    ],
    subs: [newSub, readSub, setSub, noteSub, addSub, editSub, moveSub, removeSub, statusSub, deleteSub]
});
