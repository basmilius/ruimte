import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { RecordDirectory } from '../record-directory.ts';
import { AgentKindSchema, ModelSelectionSchema, RuntimeModeSchema } from '@ruimte/contracts';
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
        ceiling: RuntimeModeSchema.optional()
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

const BackgroundLimitSchema = z.object({
    kind: z.literal('background-limit'),
    // The target is the child; the task its background commands hold open, and what they were when the limit started, for a child whose process went since.
    // `restarted` marks an entry an earlier run of the daemon owed, whose commands went down with it.
    payload: z.object({ taskId: z.string().min(1), commands: z.array(z.string()), restarted: z.literal(true).optional() })
});

const WakeParentSchema = z.object({
    kind: z.literal('wake-parent'),
    // The target is the chat to wake; the task that settled is only what owed it, since a wake takes every settled task.
    payload: z.object({ taskId: z.string().min(1) })
});

const GiveTaskSchema = z.object({
    kind: z.literal('give-task'),
    // The target is the agent the task went to; the record itself holds what it asks and who asked.
    payload: z.object({ taskId: z.string().min(1) })
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

const DeliverWaitingSchema = z.object({
    kind: z.literal('deliver-waiting'),
    // The target is the chat that gave the child its task; the child waits on this request of its own.
    payload: z.object({ childId: z.string().min(1), requestId: z.string().min(1) })
});

const OutboxWorkSchema = z.discriminatedUnion('kind', [
    StartAgentSchema,
    ResumeRunSchema,
    ResumeLimitSchema,
    BackgroundLimitSchema,
    WakeParentSchema,
    GiveTaskSchema,
    DeliverMessageSchema,
    EndChildrenSchema,
    DeliverSummarySchema,
    DeliverWaitingSchema
]);

const OutboxEntrySchema = z.intersection(
    OutboxWorkSchema,
    z.object({
        id: z.string().min(1),
        projectId: z.string().min(1),
        // The node the work is about. Entries for one target run one at a time, and it goes with the node.
        target: z.string().min(1),
        createdAt: z.number(),
        attempts: z.number().int().nonnegative(),
        notBefore: z.number()
    })
);

export type OutboxWork = z.infer<typeof OutboxWorkSchema>;
export type OutboxEntry = z.infer<typeof OutboxEntrySchema>;
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

/* The nodes an entry is about. Work on any of them waits while it runs. Ending children holds their lanes too, so no start or resume of one runs beside it. */
export const lanesOf = (entry: OutboxEntry): string[] => (entry.kind === 'end-children' ? [entry.target, ...entry.payload.nodeIds] : [entry.target]);

/*
 * Work the daemon still owes, one file per entry under `$RUIMTE_HOME/outbox`, removed once it is
 * done. On disk because the owing outlives the process. A node written a moment before a restart
 * still has its agent started after it. Only a verb or a restart puts something here, never a clock;
 * the exceptions are a `resume-limit`, only where a person turned it on, a `background-limit` and
 * the grace of a `deliver-waiting`, each due at a time.
 */
export class OutboxStore {
    readonly dir: string;
    private readonly entries: RecordDirectory<OutboxEntry>;

    constructor(home: string) {
        this.dir = join(home, 'outbox');
        this.entries = new RecordDirectory({ dir: this.dir, schema: OutboxEntrySchema, idOf: (entry) => entry.id });
    }

    /* Reads what an earlier run of the daemon still owed. Call before the worker starts. */
    load(): Promise<void> {
        return this.entries.load();
    }

    /* `notBefore` later than `now` is work due at a time, which holds no lane until then. */
    async put(projectId: string, target: string, work: OutboxWork, now: number, notBefore = now): Promise<OutboxEntry> {
        const entry: OutboxEntry = {
            ...work,
            id: `${work.kind}-${randomBytes(6).toString('hex')}`,
            projectId,
            target,
            createdAt: now,
            attempts: 0,
            notBefore
        };
        await this.entries.write(entry);
        return entry;
    }

    /* The same entry with what its last attempt left behind. */
    async update(entry: OutboxEntry): Promise<void> {
        if (!this.entries.has(entry.id)) {
            return;
        }
        await this.entries.write(entry);
    }

    remove(id: string): Promise<void> {
        return this.entries.remove(id);
    }

    /* Oldest first, which is the order the work was owed in. */
    list(): OutboxEntry[] {
        return this.entries.all().sort((a, b) => a.createdAt - b.createdAt);
    }

    has(id: string): boolean {
        return this.entries.has(id);
    }

    /*
     * Drops what this project owed for ids it no longer has. Nothing is started for a node that was
     * deleted. Ending the children of a deleted node is owed exactly because it is gone, so that stays.
     */
    prune(projectId: string, ids: ReadonlySet<string>): Promise<void> {
        return this.entries.prune((entry) => entry.projectId === projectId && entry.kind !== 'end-children' && !ids.has(entry.target));
    }
}
