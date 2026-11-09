import {
    OutboxStore as BaseOutboxStore,
    type OutboxEntryOf,
    DeliverMessageWorkSchema,
    EndChildrenWorkSchema,
    BackgroundLimitWorkSchema,
    DeliverWaitingWorkSchema,
    GiveTaskWorkSchema,
    ResumeRunWorkSchema,
    WakeParentWorkSchema
} from '@adecore/agents/coordination';
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
        // The mode `mode` asked for, the mode of the chat that opened a chat, or the mode a terminal was written down with.
        runtimeMode: RuntimeModeSchema.optional(),
        // The mode of the node that opened it, which nothing the agent starts with may be wider than; absent on an older entry.
        ceiling: RuntimeModeSchema.optional(),
        // The account of its CLI, inherited from the node that opened it; absent is the default account.
        account: ProviderAccountIdSchema.optional()
    })
});

const ResumeLimitSchema = z.object({
    kind: z.literal('resume-limit'),
    // The target is the chat; the turn that stopped on a limit, which a turn opened at `notBefore` takes up again.
    payload: z.object({ turnId: z.string().min(1) })
});

const DeliverSummarySchema = z.object({
    kind: z.literal('deliver-summary'),
    // The target is the chat the summary is for; the fork wrote it in this turn.
    payload: z.object({ forkId: z.string().min(1), turnId: z.string().min(1), text: z.string() })
});

const DeliverPrWatchSchema = z.object({
    kind: z.literal('deliver-pr-watch'),
    // The target is the watching chat; the text and label are what the poll found, written when it did.
    payload: z.object({ watchId: z.string().min(1), key: z.string().min(1), text: z.string(), label: z.string() })
});

const DeliverAnswerSchema = z.object({
    kind: z.literal('deliver-answer'),
    // The target is the chat whose card a person answered; the text and label say what they answered, written when they did.
    payload: z.object({ text: z.string(), label: z.string() })
});

const RunAfterSettleSchema = z.object({
    kind: z.literal('run-after-settle'),
    // The target is the chat that settled in `worktree`; `launchId` is the task its project ran after it then.
    payload: z.object({ turnId: z.string().min(1), launchId: z.string().min(1), worktree: z.string().min(1) })
});

const ConnectPeerSchema = z.object({
    kind: z.literal('connect-peer'),
    // The target is `peer:<machineId>`, the machine whose link is owed. `since` is when it was first owed, which the 7 days count from; `interval` is the wait after the next failure.
    payload: z.object({ machineId: z.string().min(1), since: z.number(), interval: z.number().positive() })
});

const StartRemoteAgentSchema = z.object({
    kind: z.literal('start-remote-agent'),
    // The target is the node here that stands for the agent. What the task asks is in its record (`taskId`); this is where and how it runs there.
    payload: z.object({
        machineId: z.string().min(1),
        // The project there that the link names.
        remoteProjectId: z.string().min(1),
        taskId: z.string().min(1),
        node: z.enum(['chat', 'terminal']),
        provider: AgentKindSchema,
        // The node here that gave the task, which that machine counts its agents under.
        parentId: z.string().min(1),
        // What the tool asked and the mode its parent has; that machine narrows both again.
        mode: RuntimeModeSchema.optional(),
        ceiling: RuntimeModeSchema,
        depth: z.number().int().min(0),
        // With a worktree there: the checkout here that is sent over, and the branch it becomes. Both or neither.
        source: z.string().min(1).optional(),
        branch: z.string().min(1).optional(),
        // Set before `peer.taskStart` goes out and cleared on a refusal, so dropping the entry knows whether an agent may run there.
        sent: z.boolean().optional()
    })
});

const StopRemoteAgentSchema = z.object({
    kind: z.literal('stop-remote-agent'),
    // The target is `peer:<machineId>`. Owed because the node or the task is gone, so it outlives any node.
    // `once` is a stop placed after the reconnect gave up: asked over a link that happens to be open, and never the reason to open one.
    payload: z.object({ machineId: z.string().min(1), nodeId: z.string().min(1), once: z.boolean().optional() })
});

const TakeRemoteResultSchema = z.object({
    kind: z.literal('take-remote-result'),
    // The target is the node here that stands for the agent; it is owed from the moment the task started there until its result is taken in.
    // `haves` are the commits of the checkout that was sent, which the work coming back is built on and so leaves out.
    payload: z.object({ machineId: z.string().min(1), taskId: z.string().min(1), haves: z.array(z.string().min(1)).max(20).optional() })
});

const DeliverRemoteResultSchema = z.object({
    kind: z.literal('deliver-remote-result'),
    // The target is `peer:<machineId>`, the machine that gave the task. The entry stays until that machine says it has the result (`peer.result` with `ack`), however long it is away.
    payload: z.object({ machineId: z.string().min(1), nodeId: z.string().min(1), taskId: z.string().min(1) })
});

const RoutineRunWorkSchema = z.object({
    kind: z.literal('routine-run'),
    // The target is `routine:<projectId>:<routineId>`; `due` is the time it is owed for, which `notBefore` holds too.
    payload: z.object({ routineId: z.string().min(1), due: z.number().int().nonnegative() })
});

// The kinds of tasks, ending children and delivering a message are @adecore/agents' own.
const OutboxWorkSchema = z.discriminatedUnion('kind', [
    StartAgentSchema,
    ResumeRunWorkSchema,
    ResumeLimitSchema,
    BackgroundLimitWorkSchema,
    WakeParentWorkSchema,
    GiveTaskWorkSchema,
    DeliverMessageWorkSchema,
    EndChildrenWorkSchema,
    DeliverSummarySchema,
    DeliverWaitingWorkSchema,
    DeliverPrWatchSchema,
    DeliverAnswerSchema,
    RunAfterSettleSchema,
    ConnectPeerSchema,
    DeliverRemoteResultSchema,
    StartRemoteAgentSchema,
    StopRemoteAgentSchema,
    TakeRemoteResultSchema,
    RoutineRunWorkSchema
]);

export type OutboxWork = z.infer<typeof OutboxWorkSchema>;
export type OutboxEntry = OutboxEntryOf<OutboxWork>;
export type StartAgentEntry = Extract<OutboxEntry, { kind: 'start-agent' }>;
export type ResumeRunEntry = Extract<OutboxEntry, { kind: 'resume-run' }>;
export type WakeParentEntry = Extract<OutboxEntry, { kind: 'wake-parent' }>;
export type EndChildrenEntry = Extract<OutboxEntry, { kind: 'end-children' }>;
export type DeliverSummaryEntry = Extract<OutboxEntry, { kind: 'deliver-summary' }>;
export type RunAfterSettleEntry = Extract<OutboxEntry, { kind: 'run-after-settle' }>;
export type ConnectPeerEntry = Extract<OutboxEntry, { kind: 'connect-peer' }>;
export type StartRemoteAgentEntry = Extract<OutboxEntry, { kind: 'start-remote-agent' }>;
export type StopRemoteAgentEntry = Extract<OutboxEntry, { kind: 'stop-remote-agent' }>;
export type TakeRemoteResultEntry = Extract<OutboxEntry, { kind: 'take-remote-result' }>;
export type StartRemoteAgentPayload = StartRemoteAgentEntry['payload'];
export type DeliverRemoteResultEntry = Extract<OutboxEntry, { kind: 'deliver-remote-result' }>;
export type RoutineRunEntry = Extract<OutboxEntry, { kind: 'routine-run' }>;

/* Work the daemon still owes, under `$RUIMTE_HOME/outbox`. Which kinds are due later, and why, is in this folder's CLAUDE.md. */
export class OutboxStore extends BaseOutboxStore<OutboxWork> {
    constructor(home: string) {
        super({
            dataDir: home,
            work: OutboxWorkSchema,
            // Ending children holds their lanes too, so no start or resume of one runs beside it.
            lanesOf: (entry) => (entry.kind === 'end-children' ? [entry.target, ...entry.payload.nodeIds] : [entry.target]),
            // Ending the children of a deleted node is owed exactly because it is gone, and what is owed to a machine or a routine has no node for a target.
            outlivesTarget: (entry) =>
                entry.kind === 'end-children' ||
                entry.kind === 'connect-peer' ||
                entry.kind === 'deliver-remote-result' ||
                entry.kind === 'stop-remote-agent' ||
                entry.kind === 'routine-run'
        });
    }
}
