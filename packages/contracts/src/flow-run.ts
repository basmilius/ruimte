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
    note: z.string().optional(),
    /* Written down rather than carried out, which is what the note holds the filled-in text for. */
    dry: z.literal(true).optional()
});
export type FlowRunStep = z.infer<typeof FlowRunStepSchema>;

/* How far a test reaches: the card and everything after it, or that one card on its own. */
export const FlowTestScopeSchema = z.enum(['graph', 'card']);
export type FlowTestScope = z.infer<typeof FlowTestScopeSchema>;

/* A test a person started, which is what keeps it apart from the runs the flow did by itself. */
export const FlowRunTestSchema = z.object({
    from: z.string().min(1),
    scope: FlowTestScopeSchema,
    by: z.string().optional()
});
export type FlowRunTest = z.infer<typeof FlowRunTestSchema>;

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
    tokens: z.record(z.string(), FlowArgValueSchema),
    /* Nothing this run did left the machine: every card that could act wrote down what it would do. */
    dry: z.literal(true).optional(),
    /* Present on a run a person started to try something, never on one a trigger began. */
    test: FlowRunTestSchema.optional()
});
export type FlowRun = z.infer<typeof FlowRunSchema>;

/*
 * Whether a flow runs on this machine, and under what a person allowed it to. It is never in the
 * recipe: the recipe travels and may be written by an agent, and this is one person saying yes on
 * one machine.
 */
export const FlowSwitchSchema = z.object({
    enabled: z.boolean(),
    /*
     * On, but nothing it does leaves the machine. A flow that starts agents is worth a day of this
     * first: you read the runs it would have done and only then say yes to the real thing.
     */
    watching: z.boolean().optional(),
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

/*
 * A test waiting for its trigger to fire for real. It is the best answer to a test that starts
 * halfway down a worksheet: rather than making the tokens of the cards above it up, you get the ones
 * the next real firing brings. The flow stays off, and this is spent the first time it is used.
 */
export const FlowArmedTestSchema = z.object({
    from: z.string().min(1),
    scope: FlowTestScopeSchema,
    dry: z.boolean(),
    by: z.string().optional(),
    armedAt: z.number().optional()
});
export type FlowArmedTest = z.infer<typeof FlowArmedTestSchema>;

export const FlowStateResultSchema = z.object({
    switch: FlowSwitchSchema,
    /* Newest first. */
    runs: z.array(FlowRunSchema),
    /* The test waiting for the next real firing, when there is one. */
    armed: FlowArmedTestSchema.optional()
});
export type FlowStateResult = z.infer<typeof FlowStateResultSchema>;

export const FlowEnablePayloadSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1),
    enabled: z.boolean(),
    watching: z.boolean().optional(),
    ceiling: RuntimeModeSchema.optional(),
    budget: z.number().nonnegative().optional()
});
export type FlowEnablePayload = z.infer<typeof FlowEnablePayloadSchema>;

/* Running a flow by hand, from one of the cards a run can begin at. */
export const FlowStartPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1),
    cardId: z.string().min(1)
});
export type FlowStartPayload = z.infer<typeof FlowStartPayloadSchema>;

/*
 * Trying a flow out. Dry is what the editor sends unless a person said otherwise: a test agent costs
 * money and writes in a repository, so a card says for itself whether it is harmless enough to run.
 */
export const FlowTestPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1),
    from: z.string().min(1),
    scope: FlowTestScopeSchema,
    dry: z.boolean(),
    /* What the cards above the one it starts at would have published. */
    tokens: z.record(z.string(), FlowArgValueSchema).optional()
});
export type FlowTestPayload = z.infer<typeof FlowTestPayloadSchema>;

/* Arms a test on the next real firing, or takes the armed one back with null. */
export const FlowArmPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1),
    test: FlowArmedTestSchema.nullable()
});
export type FlowArmPayload = z.infer<typeof FlowArmPayloadSchema>;

/* What a run amounted to, or null when nothing was written down at all. */
export const FlowRunResultSchema = z.object({
    run: FlowRunSchema.nullable()
});
export type FlowRunResult = z.infer<typeof FlowRunResultSchema>;

export const FlowSwitchedEventSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1),
    switch: FlowSwitchSchema
});
export type FlowSwitchedEvent = z.infer<typeof FlowSwitchedEventSchema>;

/*
 * One card of a run, the moment it settled. The timeline is written to disk per run and this is not:
 * it is what makes the worksheet light up while a run goes, and it carries the whole state of the
 * run so a client that missed one frame is not left guessing which branch died.
 */
export const FlowStepEventSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1),
    runId: z.string().min(1),
    step: FlowRunStepSchema,
    /* The port each card that is done left by, or null for one that went nowhere. */
    settled: z.record(z.string(), FlowPortSchema.nullable()),
    /* The cards the run is parked on right now. */
    waiting: z.array(z.string().min(1))
});
export type FlowStepEvent = z.infer<typeof FlowStepEventSchema>;

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
