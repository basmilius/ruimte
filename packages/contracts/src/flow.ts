import { z } from 'zod';
import { ProjectIdSchema, ProjectSaveResultSchema } from './project.ts';

/*
 * The port a line leaves a card by, which is the whole meaning of the line. A trigger and an action
 * that cannot fail only have `done`; a condition has `true` and `false`; an action that can fail has
 * `error` beside `done`. The far end has one way in, so a link never names a port there.
 */
export const FlowPortSchema = z.enum(['done', 'error', 'true', 'false']);
export type FlowPort = z.infer<typeof FlowPortSchema>;

/*
 * What a card is. The first three come from the catalog and carry a `card`; the rest are built in and
 * only say something about the graph itself.
 */
export const FlowCardKindSchema = z.enum(['trigger', 'condition', 'action', 'start', 'delay', 'any', 'all', 'note']);
export type FlowCardKind = z.infer<typeof FlowCardKindSchema>;

/* The built-in kinds, which are the ones without a card in the catalog behind them. */
export const FLOW_BUILT_IN_KINDS = ['start', 'delay', 'any', 'all', 'note'] as const;

/*
 * What a person fills in on a card. Deliberately three plain types and no expression: a text may hold
 * token references, and anything richer would be a language without a debugger.
 */
export const FlowArgValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type FlowArgValue = z.infer<typeof FlowArgValueSchema>;

export const FlowCardSchema = z.object({
    kind: FlowCardKindSchema,
    /* What it stands for in the catalog, as `agent.turn-finished`. A built-in card has none. */
    card: z.string().min(1).optional(),
    args: z.record(z.string().min(1), FlowArgValueSchema),
    /* Only on a condition: reads the outcome the other way round, which saves a NOT card. */
    inverted: z.literal(true).optional(),
    x: z.number(),
    y: z.number()
});
export type FlowCard = z.infer<typeof FlowCardSchema>;

/*
 * A line, in a list of its own rather than as an array on the card it leaves. Both directions are
 * then derivable, and a join card does not have to keep a second copy of what it waits on.
 */
export const FlowLinkSchema = z.object({
    from: z.string().min(1),
    fromPort: FlowPortSchema,
    to: z.string().min(1)
});
export type FlowLink = z.infer<typeof FlowLinkSchema>;

export const FLOW_VERSION = 1;

/*
 * The recipe: what the flow does, and nothing about whether it runs. Whether it is on, in which mode
 * and on whose word lives per machine under `$RUIMTE_HOME`, so this file can travel and be committed.
 */
export const FlowContentSchema = z.object({
    /* Where a person filed the flow. There is no interface for this yet; a flat list with search does. */
    folder: z.string().min(1).optional(),
    cards: z.record(z.string().min(1), FlowCardSchema),
    links: z.array(FlowLinkSchema)
});
export type FlowContent = z.infer<typeof FlowContentSchema>;

export const FlowDocumentSchema = FlowContentSchema.extend({
    version: z.literal(FLOW_VERSION),
    // Goes up by one on every write; a save that names an older rev is a conflict.
    rev: z.number().int().nonnegative()
});
export type FlowDocument = z.infer<typeof FlowDocumentSchema>;

export const EMPTY_FLOW: FlowDocument = { version: FLOW_VERSION, rev: 0, cards: {}, links: [] };

/* One version so far, so reading is a parse. A file that is not a flow at all reads as null. */
export const migrateFlow = (value: unknown): FlowDocument | null => {
    const parsed = FlowDocumentSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
};

export const FlowTargetPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1)
});
export type FlowTargetPayload = z.infer<typeof FlowTargetPayloadSchema>;

export const FlowOpenResultSchema = z.object({
    document: FlowDocumentSchema
});
export type FlowOpenResult = z.infer<typeof FlowOpenResultSchema>;

export const FlowSavePayloadSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1),
    // The rev the client last loaded; the daemon refuses when the file moved on.
    baseRev: z.number().int().nonnegative(),
    content: FlowContentSchema
});
export type FlowSavePayload = z.infer<typeof FlowSavePayloadSchema>;

export const FlowSaveResultSchema = ProjectSaveResultSchema;
export type FlowSaveResult = z.infer<typeof FlowSaveResultSchema>;

// Duplicating a view: the daemon copies the file under the new id at rev 0.
export const FlowCopyPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    from: z.string().min(1),
    to: z.string().min(1)
});
export type FlowCopyPayload = z.infer<typeof FlowCopyPayloadSchema>;

// The file changed under the daemon (a git pull, another machine); carries what is on disk now.
export const FlowChangedEventSchema = z.object({
    projectId: ProjectIdSchema,
    viewId: z.string().min(1),
    document: FlowDocumentSchema
});
export type FlowChangedEvent = z.infer<typeof FlowChangedEventSchema>;
