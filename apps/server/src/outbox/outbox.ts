import { OutboxStore as BaseOutboxStore, type OutboxEntryOf } from '@ruimte/agents/outbox/outbox';
import { BackgroundLimitWorkSchema, DeliverWaitingWorkSchema, GiveTaskWorkSchema, WakeParentWorkSchema } from '@ruimte/agents/tasks/task-work';
import { AgentKindSchema, ModelSelectionSchema, ProviderAccountIdSchema, RuntimeModeSchema } from '@ruimte/contracts';
import { z } from 'zod';

const StartAgentSchema = z.object({
    kind: z.literal('start-agent'),
    payload: z.object({
        node: z.enum(['chat', 'terminal']),
        provider: AgentKindSchema,
        selection: ModelSelectionSchema.optional(),
        // Null starts where a session without a directory starts, which is the machine's home.
        cwd: z.string().nullable(),
        // The mode `--mode` asked for, the mode of the chat that opened a chat, or the mode a terminal was written down with.
        runtimeMode: RuntimeModeSchema.optional(),
        // The mode of the node that opened it, which nothing the agent starts with may be wider than; absent on an older entry.
        ceiling: RuntimeModeSchema.optional(),
        // The account of its CLI, inherited from the node that opened it; absent is the default account.
        account: ProviderAccountIdSchema.optional()
    })
});

const ResumeRunSchema = z.object({
    kind: z.literal('resume-run'),
    // The target is the chat; the turn it was running and the attempt that takes it up again.
    payload: z.object({ turnId: z.string().min(1), attempt: z.number().int().positive() })
});

const ResumeLimitSchema = z.object({
    kind: z.literal('resume-limit'),
    // The target is the chat; the turn that stopped on a limit, which a turn opened at `notBefore` takes up again.
    payload: z.object({ turnId: z.string().min(1) })
});

const DeliverMessageSchema = z.object({
    kind: z.literal('deliver-message'),
    // The target is the chat the message was left for; the message itself waits in the notice store, with any that came in beside it.
    payload: z.object({ from: z.string().min(1) })
});

const EndChildrenSchema = z.object({
    kind: z.literal('end-children'),
    // The target is the node that was stopped or deleted; these are the agents it had opened when that was owed.
    payload: z.object({ nodeIds: z.array(z.string().min(1)) })
});

const DeliverSummarySchema = z.object({
    kind: z.literal('deliver-summary'),
    // The target is the chat the summary is for; the fork wrote it in this turn.
    payload: z.object({ forkId: z.string().min(1), turnId: z.string().min(1), text: z.string() })
});

// The kinds a task owes are @ruimte/agents' own (`tasks/task-work.ts`), each at the place it always had.
const OutboxWorkSchema = z.discriminatedUnion('kind', [
    StartAgentSchema,
    ResumeRunSchema,
    ResumeLimitSchema,
    BackgroundLimitWorkSchema,
    WakeParentWorkSchema,
    GiveTaskWorkSchema,
    DeliverMessageSchema,
    EndChildrenSchema,
    DeliverSummarySchema,
    DeliverWaitingWorkSchema
]);

export type OutboxWork = z.infer<typeof OutboxWorkSchema>;
export type OutboxEntry = OutboxEntryOf<OutboxWork>;
export type StartAgentEntry = Extract<OutboxEntry, { kind: 'start-agent' }>;
export type ResumeRunEntry = Extract<OutboxEntry, { kind: 'resume-run' }>;
export type ResumeLimitEntry = Extract<OutboxEntry, { kind: 'resume-limit' }>;
export type BackgroundLimitEntry = Extract<OutboxEntry, { kind: 'background-limit' }>;
export type WakeParentEntry = Extract<OutboxEntry, { kind: 'wake-parent' }>;
export type GiveTaskEntry = Extract<OutboxEntry, { kind: 'give-task' }>;
export type DeliverMessageEntry = Extract<OutboxEntry, { kind: 'deliver-message' }>;
export type EndChildrenEntry = Extract<OutboxEntry, { kind: 'end-children' }>;
export type DeliverSummaryEntry = Extract<OutboxEntry, { kind: 'deliver-summary' }>;
export type DeliverWaitingEntry = Extract<OutboxEntry, { kind: 'deliver-waiting' }>;

/*
 * Work the daemon still owes, under `$RUIMTE_HOME/outbox`. Only a verb or a restart puts something
 * here, never a clock; the exceptions are a `resume-limit`, only where a person turned it on, a
 * `background-limit` and the grace of a `deliver-waiting`, each due at a time.
 */
export class OutboxStore extends BaseOutboxStore<OutboxWork> {
    constructor(home: string) {
        super({
            dataDir: home,
            work: OutboxWorkSchema,
            // Ending children holds their lanes too, so no start or resume of one runs beside it.
            lanesOf: (entry) => (entry.kind === 'end-children' ? [entry.target, ...entry.payload.nodeIds] : [entry.target]),
            // Ending the children of a deleted node is owed exactly because it is gone.
            outlivesTarget: (entry) => entry.kind === 'end-children'
        });
    }
}
