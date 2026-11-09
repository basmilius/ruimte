import type { OutboxEntryOf } from '@adecore/agents/coordination';
import type { z } from 'zod';

/* The schema of one kind of owed work: a literal `kind` and the payload that kind carries. */
type OutboxKindSchema = z.ZodObject<{ kind: z.ZodLiteral<string>; payload: z.ZodType }>;

type OutboxEntryOfSchema<Schema extends OutboxKindSchema> = OutboxEntryOf<z.infer<Schema>>;

/* What the chat is told when the work was given up on. */
export interface OutboxParkedNote<Entry> {
    /* `title` is the node the entry is about, `reason` what the last attempt failed with. */
    text(entry: Entry, title: string, reason: string): string;
    /* Whose thread says it: the chat that opened the node (the default), or the chat the entry is for. */
    chat?: 'opener' | 'target';
    /* Also raises attention on that chat. */
    alert?: boolean;
}

interface OutboxKindTraits<Schema extends OutboxKindSchema> {
    /* Work owed exactly because its target is gone, which pruning therefore keeps. */
    outlivesTarget?: boolean;
    /* The nodes the work holds beside its target, so nothing else about them runs while it does. */
    lanes?(entry: OutboxEntryOfSchema<Schema>): string[];
    /* The machine the work is owed to, for kinds that wait on another machine's link. */
    owedTo?(payload: z.infer<Schema>['payload']): string;
    /* How often a failure is tried again before the work is given up on; the worker's default without it. */
    retries?: number;
    /* Said when the work is given up on; nothing is said without it. */
    parked?: OutboxParkedNote<OutboxEntryOfSchema<Schema>>;
}

/*
 * One kind of work the outbox owes, declared beside the feature that writes and does it. The list in
 * `outbox/kinds.ts` is what the store, the worker and the reconnect to a machine are built from.
 */
export interface OutboxKind<Schema extends OutboxKindSchema = OutboxKindSchema> extends OutboxKindTraits<Schema> {
    readonly kind: z.infer<Schema>['kind'];
    readonly schema: Schema;
    readonly outlivesTarget: boolean;
}

export function defineOutboxKind<const Schema extends OutboxKindSchema>(schema: Schema, traits: OutboxKindTraits<Schema> = {}): OutboxKind<Schema> {
    return { ...traits, kind: schema.shape.kind.value, schema, outlivesTarget: traits.outlivesTarget ?? false };
}
