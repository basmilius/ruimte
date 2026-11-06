import { PlanChecksSchema, PlanKindSchema, PlanSchema, PLAN_LIMITS, PlanStepStateSchema } from '@ruimte/contracts';
import { z } from 'zod';
import { AGENT, PERSON, agentField, PERSON_VOICE_AND_AGENT, planId, PLAN_ITEM_TYPES, planChanged, planChat } from './fields.ts';

export const PLANS_ACTIONS = {
    'plan.list': {
        title: 'List plans',
        description: 'Lists every plan of an AI Chat, oldest first.',
        agentDescription: 'Lists every plan of this chat, oldest first.',
        effect: 'read',
        domain: 'plans',
        actors: PERSON_VOICE_AND_AGENT,
        input: z.object({ chatId: planChat }),
        output: z.object({ plans: z.array(PlanSchema) })
    },
    'plan.read': {
        title: 'Read a plan',
        description: 'Reads the newest plan of an AI Chat, or the one named, with every item and its id.',
        agentDescription: 'Prints the newest plan of this chat as text, with every id in brackets; after a compaction this is how you find the ids again.',
        effect: 'read',
        domain: 'plans',
        actors: PERSON_VOICE_AND_AGENT,
        input: z.object({ chatId: planChat, planId }),
        output: z.object({
            // Null when this chat has no plan at all.
            plan: PlanSchema.nullable(),
            others: z.array(PlanSchema)
        })
    },
    'plan.create': {
        title: 'Make a plan',
        description: 'Makes a plan for this chat from a JSON document or a Markdown task list.',
        effect: 'shared',
        domain: 'plans',
        actors: AGENT,
        input: z.object({
            document: z.string().nullable().describe('The plan as one JSON object, { meta, items }'),
            markdown: z.string().nullable().describe('A GFM task list instead of JSON'),
            title: z.string().min(1).max(PLAN_LIMITS.title).nullable().describe('The title, over the one in the document'),
            kind: PlanKindSchema.nullable(),
            checks: PlanChecksSchema.nullable()
        }),
        output: z.object({ plan: PlanSchema })
    },
    'plan.setStepState': {
        title: 'Set plan steps',
        description:
            'Sets the state of one or more steps of a plan, such as done when the user ticks it off. A step only the user checks, or one the agent checks until the user unlocks it, is refused.',
        agentDescription: 'Sets the state of one or more steps in one rev; with next the step you move on to becomes active in the same rev.',
        effect: 'shared',
        domain: 'plans',
        actors: PERSON_VOICE_AND_AGENT,
        input: z.object({
            chatId: planChat,
            planId,
            stepIds: z.array(z.string().min(1)).min(1).describe('One or more steps without sub-steps, by id'),
            state: PlanStepStateSchema,
            note: z.string().nullable().describe('A note on each of the steps; an empty one clears it'),
            // Moving the work on is the agent's; @adecore/plan refuses it from a person.
            next: agentField(z.string().min(1)).describe('The step that becomes active in the same rev')
        }),
        output: planChanged
    },
    'plan.addNote': {
        title: 'Note a plan step',
        description: 'Writes the note of a step; an empty text clears it.',
        agentDescription: 'Writes the note of a step, also one a person set; an empty text clears it.',
        effect: 'shared',
        domain: 'plans',
        actors: PERSON_VOICE_AND_AGENT,
        input: z.object({ chatId: planChat, planId, stepId: z.string().min(1).describe('The step, by id'), text: z.string().describe('The note') }),
        output: planChanged
    },
    'plan.unlock': {
        title: 'Unlock plan steps',
        description: 'Lets anyone check steps that only the agent checked until now; without steps every one of the plan.',
        effect: 'shared',
        domain: 'plans',
        // Unlocking widens who may check a step, which is the person's alone.
        actors: PERSON,
        input: z.object({
            chatId: z.string().min(1),
            planId,
            stepIds: z.array(z.string().min(1)).min(1).nullable().describe('The steps, by id; null for every step')
        }),
        output: planChanged
    },
    'plan.addItem': {
        title: 'Add a plan item',
        description: 'Adds a step, text block or section to a plan.',
        effect: 'shared',
        domain: 'plans',
        actors: AGENT,
        input: z.object({
            planId,
            type: z.enum(PLAN_ITEM_TYPES).describe('step, text or section'),
            title: z.string().min(1).describe('One line'),
            description: z.string().nullable().describe('Short Markdown'),
            under: z.string().min(1).nullable().describe('The section or step it goes in, last'),
            after: z.string().min(1).nullable().describe('The item it goes right after'),
            checks: PlanChecksSchema.nullable().describe('Who sets a new step: anyone, agent or person'),
            itemId: z.string().min(1).nullable().describe('The id you want, lowercase letters, digits and dashes; minted when absent')
        }),
        output: planChanged.extend({ itemId: z.string() })
    },
    'plan.editItem': {
        title: 'Edit a plan item',
        description: 'Changes the title, description or checks of an item.',
        effect: 'shared',
        domain: 'plans',
        actors: AGENT,
        input: z.object({
            planId,
            itemId: z.string().min(1).describe('The item, by id'),
            title: z.string().min(1).nullable().describe('The new title'),
            description: z.string().nullable().describe('The new description; an empty one removes it'),
            checks: PlanChecksSchema.nullable().describe('Who sets the step')
        }),
        output: planChanged
    },
    'plan.moveItem': {
        title: 'Move a plan item',
        description: 'Moves an item, with everything under it, to another place in the plan.',
        effect: 'shared',
        domain: 'plans',
        actors: AGENT,
        input: z.object({
            planId,
            itemId: z.string().min(1).describe('The item, by id'),
            under: z.string().min(1).nullable().describe('The section or step it goes in, last'),
            after: z.string().min(1).nullable().describe('The item it goes right after')
        }),
        output: planChanged
    },
    'plan.removeItem': {
        title: 'Remove a plan item',
        description: 'Removes an item and everything under it; refused when a person set a state in it.',
        effect: 'shared',
        domain: 'plans',
        actors: AGENT,
        input: z.object({ planId, itemId: z.string().min(1).describe('The item, by id') }),
        output: planChanged
    },
    'plan.setStatus': {
        title: 'Set plan status',
        description: 'Sets the line under the title about what happens now or next; an empty text clears it.',
        effect: 'shared',
        domain: 'plans',
        actors: AGENT,
        input: z.object({ planId, text: z.string().describe('One short sentence, such as Fixing the focus bug in the grid') }),
        output: planChanged
    },
    'plan.delete': {
        title: 'Delete a plan',
        description: 'Removes a whole plan of this chat.',
        effect: 'shared',
        domain: 'plans',
        actors: AGENT,
        input: z.object({ planId: z.string().min(1).describe('The plan by id; never the newest by default, since this cannot be undone') }),
        output: z.object({ planId: z.string(), title: z.string() })
    }
} as const;
