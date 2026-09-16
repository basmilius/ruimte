import { z } from 'zod';
import { ChatIdSchema } from './chat.ts';

/*
 * A plan belongs to a chat: a tree of steps an agent writes and a person checks off. The limits are
 * part of the contract so every side refuses the same plan; depth and item count need the whole tree
 * and are checked in `@ruimte/plan`.
 */
export const PLAN_LIMITS = {
    idLength: 64,
    title: 200,
    description: 1000,
    note: 500,
    status: 200,
    depth: 5,
    items: 300,
    plansPerChat: 20
} as const;

export const PlanItemIdSchema = z
    .string()
    .min(1)
    .max(PLAN_LIMITS.idLength)
    .regex(/^[a-z0-9-]+$/);
export type PlanItemId = z.infer<typeof PlanItemIdSchema>;

export const PlanIdSchema = PlanItemIdSchema;
export type PlanId = z.infer<typeof PlanIdSchema>;

// Final: the iPhone app validates a plan whole, so anything new becomes an optional field instead.
export const PlanStepStateSchema = z.enum(['open', 'active', 'done', 'failed', 'skipped', 'blocked', 'warning', 'info']);
export type PlanStepState = z.infer<typeof PlanStepStateSchema>;

export const PlanChecksSchema = z.enum(['anyone', 'agent', 'person']);
export type PlanChecks = z.infer<typeof PlanChecksSchema>;

export const PlanActorSchema = z.enum(['person', 'agent']);
export type PlanActor = z.infer<typeof PlanActorSchema>;

export const PlanKindSchema = z.enum(['steps', 'test']);
export type PlanKind = z.infer<typeof PlanKindSchema>;

const TitleSchema = z.string().min(1).max(PLAN_LIMITS.title);
const DescriptionSchema = z.string().max(PLAN_LIMITS.description);
const NoteSchema = z.string().max(PLAN_LIMITS.note);

export const PlanMetaSchema = z.object({
    title: TitleSchema,
    kind: PlanKindSchema,
    summary: DescriptionSchema.optional(),
    // One line under the title, for a plan that tracks progress.
    status: z.string().max(PLAN_LIMITS.status).optional(),
    // Who sets a step that names no `checks` of its own.
    checks: PlanChecksSchema
});
export type PlanMeta = z.infer<typeof PlanMetaSchema>;

export const PlanStepSchema = z.object({
    type: z.literal('step'),
    id: PlanItemIdSchema,
    title: TitleSchema,
    description: DescriptionSchema.optional(),
    checks: PlanChecksSchema.optional(),
    // Only on a step without sub-steps; a parent derives its state from its children.
    state: PlanStepStateSchema.optional(),
    // Who set the state last and when, filled by the daemon and never by an agent.
    by: PlanActorSchema.optional(),
    at: z.string().optional(),
    note: NoteSchema.optional(),
    // A person lifted the lock, so the step is `anyone` from then on and an agent cannot lock it again.
    unlocked: z.boolean().optional(),
    get steps() {
        return z.array(PlanStepSchema).optional();
    }
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const PlanTextSchema = z.object({
    type: z.literal('text'),
    id: PlanItemIdSchema,
    title: TitleSchema,
    description: DescriptionSchema.optional()
});
export type PlanText = z.infer<typeof PlanTextSchema>;

// Sections do not nest: they only stand at the top of a plan.
export const PlanSectionSchema = z.object({
    type: z.literal('section'),
    id: PlanItemIdSchema,
    title: TitleSchema,
    description: DescriptionSchema.optional(),
    items: z.array(z.discriminatedUnion('type', [PlanTextSchema, PlanStepSchema]))
});
export type PlanSection = z.infer<typeof PlanSectionSchema>;

export const PlanItemSchema = z.discriminatedUnion('type', [PlanSectionSchema, PlanTextSchema, PlanStepSchema]);
export type PlanItem = z.infer<typeof PlanItemSchema>;

export const PlanSchema = z.object({
    id: PlanIdSchema,
    // Goes up by one on every applied batch of operations.
    rev: z.number().int().nonnegative(),
    createdAt: z.string(),
    meta: PlanMetaSchema,
    items: z.array(PlanItemSchema)
});
export type Plan = z.infer<typeof PlanSchema>;

/*
 * Operations name items by id and apply to the latest rev, without a base rev: a person's click and
 * an agent's update never conflict, and an operation whose id is gone is refused instead.
 */
export const PlanSetOpSchema = z.object({
    op: z.literal('set'),
    ids: z.array(PlanItemIdSchema).min(1),
    state: PlanStepStateSchema,
    note: NoteSchema.optional(),
    // Agent only: the step that becomes active in the same rev, so the work moves on without a gap.
    next: PlanItemIdSchema.optional()
});
export type PlanSetOp = z.infer<typeof PlanSetOpSchema>;

// An empty text clears the note.
export const PlanNoteOpSchema = z.object({
    op: z.literal('note'),
    id: PlanItemIdSchema,
    text: NoteSchema
});
export type PlanNoteOp = z.infer<typeof PlanNoteOpSchema>;

export const PlanUnlockOpSchema = z.object({
    op: z.literal('unlock'),
    ids: z.union([z.array(PlanItemIdSchema).min(1), z.literal('all')])
});
export type PlanUnlockOp = z.infer<typeof PlanUnlockOpSchema>;

/* Without `under` and `after` an item goes last at the top; with only `after` it goes right after that item, beside it. */
export const PlanAddOpSchema = z.object({
    op: z.literal('add'),
    type: z.enum(['section', 'text', 'step']),
    // Minted by the daemon when absent.
    id: PlanItemIdSchema.optional(),
    title: TitleSchema,
    description: DescriptionSchema.optional(),
    checks: PlanChecksSchema.optional(),
    under: PlanItemIdSchema.optional(),
    after: PlanItemIdSchema.optional()
});
export type PlanAddOp = z.infer<typeof PlanAddOpSchema>;

// An empty description removes it.
export const PlanEditOpSchema = z.object({
    op: z.literal('edit'),
    id: PlanItemIdSchema,
    title: TitleSchema.optional(),
    description: DescriptionSchema.optional(),
    checks: PlanChecksSchema.optional()
});
export type PlanEditOp = z.infer<typeof PlanEditOpSchema>;

export const PlanMoveOpSchema = z.object({
    op: z.literal('move'),
    id: PlanItemIdSchema,
    under: PlanItemIdSchema.optional(),
    after: PlanItemIdSchema.optional()
});
export type PlanMoveOp = z.infer<typeof PlanMoveOpSchema>;

export const PlanRemoveOpSchema = z.object({
    op: z.literal('remove'),
    id: PlanItemIdSchema
});
export type PlanRemoveOp = z.infer<typeof PlanRemoveOpSchema>;

// An empty summary or status removes it.
export const PlanMetaOpSchema = z.object({
    op: z.literal('meta'),
    title: TitleSchema.optional(),
    summary: DescriptionSchema.optional(),
    status: z.string().max(PLAN_LIMITS.status).optional(),
    checks: PlanChecksSchema.optional()
});
export type PlanMetaOp = z.infer<typeof PlanMetaOpSchema>;

// What a person may send: checking off, a note and lifting a lock. The structure is the agent's.
export const PlanPersonOpSchema = z.discriminatedUnion('op', [PlanSetOpSchema, PlanNoteOpSchema, PlanUnlockOpSchema]);
export type PlanPersonOp = z.infer<typeof PlanPersonOpSchema>;

export const PlanOpSchema = z.discriminatedUnion('op', [
    PlanSetOpSchema,
    PlanNoteOpSchema,
    PlanUnlockOpSchema,
    PlanAddOpSchema,
    PlanEditOpSchema,
    PlanMoveOpSchema,
    PlanRemoveOpSchema,
    PlanMetaOpSchema
]);
export type PlanOp = z.infer<typeof PlanOpSchema>;

export const PlanOfChatSchema = z.object({ chatId: ChatIdSchema, plan: PlanSchema });
export type PlanOfChat = z.infer<typeof PlanOfChatSchema>;

// Without `chatIds` every chat that has a plan, which is how a client fills its pills on connect.
export const PlanListPayloadSchema = z.object({ chatIds: z.array(ChatIdSchema).optional() });
export type PlanListPayload = z.infer<typeof PlanListPayloadSchema>;

export const PlanListResultSchema = z.object({ plans: z.array(PlanOfChatSchema) });
export type PlanListResult = z.infer<typeof PlanListResultSchema>;

// All or nothing, on the latest rev.
export const PlanApplyPayloadSchema = z.object({
    chatId: ChatIdSchema,
    planId: PlanIdSchema,
    ops: z.array(PlanPersonOpSchema).min(1)
});
export type PlanApplyPayload = z.infer<typeof PlanApplyPayloadSchema>;

export const PlanApplyResultSchema = z.object({ plan: PlanSchema });
export type PlanApplyResult = z.infer<typeof PlanApplyResultSchema>;

export const PlanChangedEventSchema = PlanOfChatSchema;
export type PlanChangedEvent = z.infer<typeof PlanChangedEventSchema>;

export const PlanRemovedEventSchema = z.object({ chatId: ChatIdSchema, planId: PlanIdSchema });
export type PlanRemovedEvent = z.infer<typeof PlanRemovedEventSchema>;

// Only after a new plan; a client moves the panel's anchor on this and never on `plan.changed`.
export const PlanCreatedEventSchema = z.object({ chatId: ChatIdSchema, planId: PlanIdSchema });
export type PlanCreatedEvent = z.infer<typeof PlanCreatedEventSchema>;
