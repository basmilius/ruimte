import { z } from 'zod';
import { ChatIdSchema } from './chat.ts';
import { PlanIdSchema, PlanSchema, PlanPersonOpSchema } from '@adecore/plan/protocol';

export {
    PLAN_LIMITS,
    PlanItemIdSchema,
    type PlanItemId,
    PlanIdSchema,
    type PlanId,
    PlanStepStateSchema,
    type PlanStepState,
    PlanChecksSchema,
    type PlanChecks,
    PlanActorSchema,
    type PlanActor,
    PlanKindSchema,
    type PlanKind,
    PlanMetaSchema,
    type PlanMeta,
    PlanStepSchema,
    type PlanStep,
    PlanTextSchema,
    type PlanText,
    PlanSectionSchema,
    type PlanSection,
    PlanItemSchema,
    type PlanItem,
    PlanSchema,
    type Plan,
    PlanSetOpSchema,
    type PlanSetOp,
    PlanNoteOpSchema,
    type PlanNoteOp,
    PlanUnlockOpSchema,
    type PlanUnlockOp,
    PlanAddOpSchema,
    type PlanAddOp,
    PlanEditOpSchema,
    type PlanEditOp,
    PlanMoveOpSchema,
    type PlanMoveOp,
    PlanRemoveOpSchema,
    type PlanRemoveOp,
    PlanMetaOpSchema,
    type PlanMetaOp,
    PlanPersonOpSchema,
    type PlanPersonOp,
    PlanOpSchema,
    type PlanOp
} from '@adecore/plan/protocol';

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
