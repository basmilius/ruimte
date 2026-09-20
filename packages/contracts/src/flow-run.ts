import { z } from 'zod';
import { FlowArgValueSchema, FlowPortSchema } from './flow.ts';
import { RuntimeModeSchema } from './model.ts';
import { ProjectIdSchema } from './project.ts';

/* How a run ended, or why it never began. */
export const FlowRunOutcomeSchema = z.enum(['running', 'done', 'refused', 'skipped', 'missed']);
export type FlowRunOutcome = z.infer<typeof FlowRunOutcomeSchema>;

export const FlowRunStepSchema = z.object({
    cardId: z.string().min(1),
    at: z.number(),
    /* The port the card left by; absent for a card that went nowhere at all. */
    port: FlowPortSchema.optional(),
    /* The one sentence a person reads back when they wonder why the flow did nothing. */
    note: z.string().optional()
});
export type FlowRunStep = z.infer<typeof FlowRunStepSchema>;

export const FlowRunSchema = z.object({
    id: z.string().min(1),
    /* The card the run began at. A line about a run that never began has none. */
    trigger: z.string().min(1).optional(),
    startedAt: z.number(),
    endedAt: z.number().optional(),
    outcome: FlowRunOutcomeSchema,
    note: z.string().optional(),
    /* How deep in a chain of flows this run sits; the first one a person or a clock starts is 1. */
    depth: z.number().int().positive().optional(),
    steps: z.array(FlowRunStepSchema),
    /* The port each card that is done left by, or null for one that went nowhere. Where the run stands. */
    settled: z.record(z.string(), FlowPortSchema.nullable()).optional(),
    /* The cards a run is parked on, which is what a wait card leaves behind. */
    waiting: z.array(z.string().min(1)).optional(),
    /* What the cards published, so a later run can be replayed with the values this one had. */
    tokens: z.record(z.string(), FlowArgValueSchema)
});
export type FlowRun = z.infer<typeof FlowRunSchema>;

/*
 * Whether a flow runs on this machine, and under what a person allowed it to. It is never in the
 * recipe: the recipe travels and may be written by an agent, and this is one person saying yes on
 * one machine.
 */
export const FlowSwitchSchema = z.object({
    enabled: z.boolean(),
    /* The widest mode the agents this flow starts may run in. Nothing reads it until it starts any. */
    ceiling: RuntimeModeSchema.optional(),
    /* What the flow may spend in a day. Same: it is here so the answer is already on file. */
    budget: z.number().nonnegative().optional(),
    enabledBy: z.string().optional(),
    enabledAt: z.number().optional(),
    /* The fingerprint of the recipe that was said yes to. Another one puts the flow back on off. */
    recipeHash: z.string().optional()
});
export type FlowSwitch = z.infer<typeof FlowSwitchSchema>;

export const FlowStateResultSchema = z.object({
    switch: FlowSwitchSchema,
    /* Newest first. */
    runs: z.array(FlowRunSchema)
});
export type FlowStateResult = z.infer<typeof FlowStateResultSchema>;

export const FlowEnablePayloadSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1),
    enabled: z.boolean(),
    ceiling: RuntimeModeSchema.optional(),
    budget: z.number().nonnegative().optional()
});
export type FlowEnablePayload = z.infer<typeof FlowEnablePayloadSchema>;

export const FlowSwitchedEventSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1),
    switch: FlowSwitchSchema
});
export type FlowSwitchedEvent = z.infer<typeof FlowSwitchedEventSchema>;

/* A run that began, moved or ended; the timeline on screen follows these. */
export const FlowRunEventSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1),
    run: FlowRunSchema
});
export type FlowRunEvent = z.infer<typeof FlowRunEventSchema>;

/* What the show a notification card puts on screen. */
export const FlowNoticeEventSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1),
    /* The name of the flow, so a person knows which one is talking. */
    flow: z.string(),
    text: z.string(),
    at: z.number()
});
export type FlowNoticeEvent = z.infer<typeof FlowNoticeEventSchema>;
