import { z } from 'zod';
import type { OutboxKind, OutboxParkedNote } from '../kind.ts';
import { deliverPrWatchKind } from './github.ts';
import { runAfterSettleKind } from './launches.ts';
import { deliverMessageKind, deliverSummaryKind, endChildrenKind, resumeLimitKind, resumeRunKind, startAgentKind } from './outbox.ts';
import { connectPeerKind, startRemoteAgentKind, stopRemoteAgentKind, takeRemoteResultKind } from './peer-giver.ts';
import { deliverRemoteResultKind } from './peer-worker.ts';
import { routineRunKind } from './routines.ts';
import { backgroundLimitKind, deliverWaitingKind, giveTaskKind, wakeParentKind } from './tasks.ts';

/*
 * Every kind of work the outbox owes. A new kind is its descriptor in the folder of the feature that
 * writes it and one line here; the store, the worker, the note about work given up on and the
 * reconnect to a machine are all built from this list. Its handler is added to the worker where the
 * feature is wired (`worker.handle`), and the worker refuses to start without one.
 */
export const OUTBOX_KINDS = [
    startAgentKind,
    resumeRunKind,
    resumeLimitKind,
    backgroundLimitKind,
    wakeParentKind,
    giveTaskKind,
    deliverMessageKind,
    endChildrenKind,
    deliverSummaryKind,
    deliverWaitingKind,
    deliverPrWatchKind,
    runAfterSettleKind,
    connectPeerKind,
    deliverRemoteResultKind,
    startRemoteAgentKind,
    stopRemoteAgentKind,
    takeRemoteResultKind,
    routineRunKind
] as const;

type KindOf<Descriptor> = Descriptor extends OutboxKind<infer Schema> ? z.infer<Schema> : never;

export type OutboxWork = KindOf<(typeof OUTBOX_KINDS)[number]>;
export type OutboxKindName = OutboxWork['kind'];

export const OutboxWorkSchema = z.discriminatedUnion(
    'kind',
    OUTBOX_KINDS.map((descriptor) => descriptor.schema) as unknown as [z.ZodType<OutboxWork> & z.ZodObject<{ kind: z.ZodLiteral<string> }>]
) as unknown as z.ZodType<OutboxWork>;

/* What the store and the worker ask of a kind, with the entry types of the kinds apart left out. */
interface KindTraits {
    outlivesTarget: boolean;
    retries?: number;
    lanes?(entry: { kind: string; target: string; payload: unknown }): string[];
    owedTo?(payload: unknown): string;
    parked?: OutboxParkedNote<{ kind: string; target: string; payload: unknown }>;
}

// Each descriptor takes the entry of its own kind, which a lookup by name cannot know; the name is what ties them together.
const TRAITS = new Map<string, KindTraits>(OUTBOX_KINDS.map((descriptor) => [descriptor.kind, descriptor as unknown as KindTraits]));

export function traitsOf(kind: string): KindTraits {
    const traits = TRAITS.get(kind);
    if (traits === undefined) {
        throw new Error(`${kind} is no kind of outbox work`);
    }
    return traits;
}

/* The retries each kind sets for itself, for the worker. */
export function outboxRetries(): Partial<Record<OutboxKindName, number>> {
    return Object.fromEntries(OUTBOX_KINDS.flatMap((descriptor) => (descriptor.retries === undefined ? [] : [[descriptor.kind, descriptor.retries]])));
}

export const OUTBOX_KIND_NAMES: readonly OutboxKindName[] = OUTBOX_KINDS.map((descriptor) => descriptor.kind);
