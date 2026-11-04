import { ToolRefusal } from '@adecore/agents/context';
import {
    PlanDraftMetaSchema,
    PlanDraftSectionSchema,
    PlanDraftStepSchema,
    PlanDraftTextSchema,
    activeStepIds,
    allSteps,
    isParentStep,
    progressText,
    renderPlanText
} from '@adecore/plan';
import type { ActionOutput } from '@ruimte/actions';
import { PLAN_LIMITS, PlanChecksSchema, PlanKindSchema, PlanStepStateSchema, type PlanItem } from '@ruimte/contracts';
import { z } from 'zod';
import { defineActionTool, runAction } from './action-tool.ts';
import { field } from './host.ts';
import { fieldLines } from './schema-lines.ts';
import { defineTool, defineToolkit, type GuideTopic } from './tool.ts';

/* Agents repeat ids to people, who only know a plan and its steps by their titles. */
const IDS_LINE = 'ids\tIds are for your tool calls. When you talk to the person, name the plan and its steps by their title, never by id';

const NO_PLAN = 'note\tThis chat has no plan; plan_new makes one';

const META_FIELDS: Record<keyof typeof PlanDraftMetaSchema.shape, string> = {
    title: 'What the plan is called; title wins over it, and one of the two is required',
    kind: 'steps for progress you keep, test for a test plan a person runs; steps when absent, and kind wins',
    summary: 'A short Markdown paragraph under the title about what the plan is for, never its progress',
    status: 'One short sentence about what happens now or next, such as Fixing the focus bug in the grid; never counts or progress, since the panel shows those, and absent rather than a repeat of the title or summary; plan_status changes it later',
    checks: 'Who sets a step that names no checks of its own: anyone, agent (a person unlocks it) or person; anyone when absent, and checks wins'
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

const PLAN_GUIDE: GuideTopic = {
    name: 'plan',
    lines: [
        'markdown\tA GFM task list instead of JSON: # title, ## section, - [ ] step, indented for a sub-step, > **Title** description for a text block, [x] [!] [-] [?] [~] [w] [i] for a state',
        "document\t{ meta, items }\tone JSON object; by and at are the daemon's and cannot be written",
        ...fieldLines('meta.', PlanDraftMetaSchema.shape, META_FIELDS),
        ...fieldLines('items[] step.', PlanDraftStepSchema.shape, STEP_FIELDS),
        ...fieldLines('items[] text.', PlanDraftTextSchema.shape, TEXT_FIELDS),
        ...fieldLines('items[] section.', PlanDraftSectionSchema.shape, SECTION_FIELDS),
        'strict\tA field that is not listed here is refused by its path, never dropped',
        `limits\tAt most ${PLAN_LIMITS.items} items, steps ${PLAN_LIMITS.depth} levels deep, ${PLAN_LIMITS.plansPerChat} plans per chat`,
        `example\t${PLAN_EXAMPLE}`
    ]
};

const PLAN_INPUT = z
    .string({ error: 'plan needs the id of a plan; plan_read with all lists them' })
    .min(1, 'plan needs the id of a plan; plan_read with all lists them');

const CHECKS_INPUT = z.enum(PlanChecksSchema.options, { error: `checks takes one of ${PlanChecksSchema.options.join(', ')}` }).optional();

const UNDER_INPUT = z
    .string({ error: 'under needs the id of a section or step' })
    .min(1, 'under needs the id of a section or step')
    .optional()
    .describe('The section or step it goes in, last');

const AFTER_INPUT = z
    .string({ error: 'after needs the id of an item' })
    .min(1, 'after needs the id of an item')
    .optional()
    .describe('The item it goes right after');

const ITEM_INPUT = z.string({ error: 'item_id needs the id of an item' }).min(1, 'item_id needs the id of an item');

/* What every change prints: the plan and its rev, the steps now active, and states a new sub-step took away. */
function changedLines({ plan, dropped }: ActionOutput<'plan.addNote'>): string[] {
    const active = activeStepIds(plan);

    return [
        `plan\t${plan.id}\trev ${plan.rev}\t${plan.meta.kind}\t${field(plan.meta.title)}\t${field(progressText(plan))}`,
        ...(active.length > 0 ? [`now\t${active.join('\t')}`] : []),
        ...dropped.map((id) => `dropped\t${id}\tgot its first sub-step, so its own state is gone and follows from its sub-steps`)
    ];
}

/* Every item with the id it has, the item it stands under, its kind and title, in document order. */
function itemLines(items: readonly PlanItem[], under = '-'): string[] {
    return items.flatMap((item) => [
        `item\t${item.id}\t${item.type}\t${under}\t${field(item.title)}`,
        ...itemLines(item.type === 'section' ? item.items : item.type === 'step' ? (item.steps ?? []) : [], item.id)
    ]);
}

const planNew = defineActionTool('plan', {
    name: 'plan_new',
    action: 'plan.create',
    description: 'Makes a plan for this chat from a JSON document or a Markdown task list.',
    audience: 'chat',
    input: z.object({
        document: z.string({ error: 'document is the plan as JSON text' }).optional().describe('Format: guide topic plan'),
        markdown: z.string({ error: 'markdown is the plan as a GFM task list' }).optional().describe('A GFM task list instead. Format: guide topic plan'),
        title: z
            .string({ error: 'title needs the title of the plan' })
            .min(1, 'title needs the title of the plan')
            .max(PLAN_LIMITS.title, `title fits at most ${PLAN_LIMITS.title} characters`)
            .optional(),
        kind: z.enum(PlanKindSchema.options, { error: `kind takes one of ${PlanKindSchema.options.join(', ')}` }).optional(),
        checks: CHECKS_INPUT.describe('Who sets the steps that name none'),
        dry_run: z.boolean({ error: 'dry_run is true or false' }).optional()
    }),
    async run(input, call) {
        const dryRun = input.dry_run === true;
        const { plan } = await runAction(
            call,
            'plan.create',
            {
                document: input.document ?? null,
                markdown: input.markdown ?? null,
                title: input.title ?? null,
                kind: input.kind ?? null,
                checks: input.checks ?? null
            },
            dryRun
        );
        const firstStep = allSteps(plan.items).find((step) => !isParentStep(step));

        return [
            `${dryRun ? 'dry-run' : 'plan'}\t${plan.id}\trev ${plan.rev}\t${plan.meta.kind}\t${field(plan.meta.title)}`,
            ...itemLines(plan.items),
            firstStep ? `example\tplan_set with step_id ${firstStep.id} and state done` : 'example\tplan_add with type step and title The first step',
            IDS_LINE,
            ...(dryRun ? ['note\tNothing was written; call plan_new again without dry_run to make the plan'] : [])
        ];
    }
});

const planRead = defineTool('plan', {
    name: 'plan_read',
    description: 'Prints a plan of this chat with its ids.',
    annotations: { readOnly: true },
    audience: 'chat',
    input: z.object({ plan: PLAN_INPUT.optional(), all: z.boolean({ error: 'all is true or false' }).optional() }),
    async run(input, call) {
        if (input.all === true) {
            const { plans } = await runAction(call, 'plan.list', {});

            if (plans.length === 0) {
                return [NO_PLAN];
            }

            return plans.flatMap((plan, index) => [...(index === 0 ? [] : ['']), ...renderPlanText(plan).split('\n')]);
        }

        const { plan, others } = await runAction(call, 'plan.read', { planId: input.plan ?? null });

        if (plan === null) {
            return [NO_PLAN];
        }

        return renderPlanText(plan, { others }).split('\n');
    }
});

const planSet = defineActionTool('plan', {
    name: 'plan_set',
    action: 'plan.setStepState',
    description: 'Sets the state of one or more steps in one rev.',
    audience: 'chat',
    input: z.object({
        step_id: z
            .array(z.string().min(1, 'step_id has an empty id in it'), { error: 'step_id needs the ids of the steps' })
            .min(1, 'plan_set needs the id of at least one step in step_id'),
        state: z
            .enum(PlanStepStateSchema.options, { error: `state takes one of ${PlanStepStateSchema.options.join(', ')}` })
            .describe('warning and info take a note that says what'),
        note: z.string({ error: 'note is text' }).optional(),
        next: z
            .string({ error: 'next needs the id of a step' })
            .min(1, 'next needs the id of a step')
            .optional()
            .describe('A step that becomes active in the same rev'),
        plan: PLAN_INPUT.optional()
    }),
    async run(input, call) {
        return changedLines(
            await runAction(call, 'plan.setStepState', {
                planId: input.plan ?? null,
                stepIds: input.step_id,
                state: input.state,
                note: input.note ?? null,
                next: input.next ?? null
            })
        );
    }
});

const planNote = defineActionTool('plan', {
    name: 'plan_note',
    action: 'plan.addNote',
    description: 'Writes the note of a step, also one a person set.',
    audience: 'chat',
    input: z.object({
        step_id: z.string({ error: 'plan_note needs step_id, the id of a step' }).min(1, 'plan_note needs step_id, the id of a step'),
        text: z.string({ error: 'plan_note needs text with the note, or an empty one to clear it' }),
        plan: PLAN_INPUT.optional()
    }),
    async run(input, call) {
        return changedLines(await runAction(call, 'plan.addNote', { planId: input.plan ?? null, stepId: input.step_id, text: input.text }));
    }
});

const planAdd = defineActionTool('plan', {
    name: 'plan_add',
    action: 'plan.addItem',
    description: 'Adds a step, text block or section to a plan.',
    audience: 'chat',
    input: z.object({
        type: z.enum(['step', 'text', 'section'], { error: 'type takes step, text or section' }),
        title: z.string({ error: 'plan_add needs title' }).min(1, 'plan_add needs title'),
        description: z.string({ error: 'description is text' }).optional(),
        under: UNDER_INPUT,
        after: AFTER_INPUT,
        checks: CHECKS_INPUT,
        id: z.string({ error: 'id needs an id' }).min(1, 'id needs an id').optional().describe('An id of your own'),
        plan: PLAN_INPUT.optional()
    }),
    async run(input, call) {
        const added = await runAction(call, 'plan.addItem', {
            planId: input.plan ?? null,
            type: input.type,
            title: input.title,
            description: input.description ?? null,
            under: input.under ?? null,
            after: input.after ?? null,
            checks: input.checks ?? null,
            itemId: input.id ?? null
        });

        return [...changedLines(added), `added\t${added.itemId}\t${input.type}`];
    }
});

const planEdit = defineTool('plan', {
    name: 'plan_edit',
    description: 'Changes an item of your plan, or moves it under or after another.',
    audience: 'chat',
    input: z.object({
        action: z.enum(['edit', 'move'], { error: 'plan_edit needs action, one of edit, move' }),
        item_id: ITEM_INPUT,
        title: z.string({ error: 'title may not be empty' }).min(1, 'title may not be empty').optional(),
        description: z.string({ error: 'description is text' }).optional(),
        checks: CHECKS_INPUT,
        plan: PLAN_INPUT.optional(),
        under: UNDER_INPUT,
        after: AFTER_INPUT
    }),
    async run(input, call) {
        const planId = input.plan ?? null;

        if (input.action === 'move') {
            const editing = (['title', 'description', 'checks'] as const).filter((key) => input[key] !== undefined);

            if (editing.length > 0) {
                throw new ToolRefusal('bad-arguments', `plan_edit move takes no ${editing.join(', ')}`);
            }

            return changedLines(
                await runAction(call, 'plan.moveItem', { planId, itemId: input.item_id, under: input.under ?? null, after: input.after ?? null })
            );
        }

        const moving = (['under', 'after'] as const).filter((key) => input[key] !== undefined);

        if (moving.length > 0) {
            throw new ToolRefusal('bad-arguments', `plan_edit edit takes no ${moving.join(', ')}`);
        }

        return changedLines(
            await runAction(call, 'plan.editItem', {
                planId,
                itemId: input.item_id,
                title: input.title ?? null,
                description: input.description ?? null,
                checks: input.checks ?? null
            })
        );
    }
});

const planRemove = defineActionTool('plan', {
    name: 'plan_remove',
    action: 'plan.removeItem',
    description: 'Removes an item and everything under it.',
    annotations: { destructive: true },
    audience: 'chat',
    input: z.object({ item_id: ITEM_INPUT, plan: PLAN_INPUT.optional() }),
    async run(input, call) {
        return changedLines(await runAction(call, 'plan.removeItem', { planId: input.plan ?? null, itemId: input.item_id }));
    }
});

const planStatus = defineActionTool('plan', {
    name: 'plan_status',
    action: 'plan.setStatus',
    description: 'Sets the line under the title about what happens now or next.',
    audience: 'chat',
    input: z.object({
        text: z.string({ error: 'plan_status needs text with the line, or an empty one to clear it' }).describe('One short sentence'),
        plan: PLAN_INPUT.optional()
    }),
    async run(input, call) {
        return changedLines(await runAction(call, 'plan.setStatus', { planId: input.plan ?? null, text: input.text }));
    }
});

const planDelete = defineActionTool('plan', {
    name: 'plan_delete',
    action: 'plan.delete',
    description: 'Removes a whole plan of this chat.',
    annotations: { destructive: true },
    audience: 'chat',
    input: z.object({ plan: z.string({ error: 'plan_delete needs plan, the id of the plan' }).min(1, 'plan_delete needs plan, the id of the plan') }),
    async run(input, call) {
        const deleted = await runAction(call, 'plan.delete', { planId: input.plan });

        return [`deleted\t${deleted.planId}\t${field(deleted.title)}`];
    }
});

export const planToolkit = defineToolkit('plan', [planNew, planRead, planSet, planNote, planAdd, planEdit, planRemove, planStatus, planDelete], [PLAN_GUIDE]);
