import { DeliverMessageWorkSchema, EndChildrenWorkSchema, ResumeRunWorkSchema } from '@adecore/agents/coordination';
import { AgentKindSchema, ModelSelectionSchema, ProviderAccountIdSchema, RuntimeModeSchema } from '@ruimte/contracts';
import { z } from 'zod';
import { defineOutboxKind } from '../kind.ts';

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

/* Never retried: the create takes the node's first prompt before it spawns, so a second attempt would start the agent without its task. */
export const startAgentKind = defineOutboxKind(StartAgentSchema, {
    retries: 0,
    parked: { text: (entry, title, reason) => `The machine could not start the agent in ${title} (${entry.target}): ${reason}` }
});

export const resumeRunKind = defineOutboxKind(ResumeRunWorkSchema, {
    parked: { text: (entry, title, reason) => `The machine could not resume the turn of ${title} (${entry.target}) after a restart: ${reason}` }
});

export const resumeLimitKind = defineOutboxKind(ResumeLimitSchema, {
    parked: { text: (entry, title, reason) => `The machine could not take up ${title} (${entry.target}) again after its limit: ${reason}` }
});

/* A message is nobody's to answer for but the chat it was left for, which has no opener in this. */
export const deliverMessageKind = defineOutboxKind(DeliverMessageWorkSchema, {
    parked: {
        chat: 'target',
        text: (entry, title, reason) => `The machine could not give ${title} (${entry.target}) a turn on the message it was sent: ${reason}`
    }
});

/* Owed exactly because its target is gone, and it holds the lanes of the nodes it ends, so no start or resume of one runs beside it. */
export const endChildrenKind = defineOutboxKind(EndChildrenWorkSchema, {
    outlivesTarget: true,
    lanes: (entry) => [entry.target, ...entry.payload.nodeIds],
    parked: { text: (entry, title, reason) => `The machine could not end the agents ${title} (${entry.target}) opened: ${reason}` }
});

/* A summary that was not delivered is said in its fork, by its own handler. */
export const deliverSummaryKind = defineOutboxKind(DeliverSummarySchema);

const DeliverAnswerSchema = z.object({
    kind: z.literal('deliver-answer'),
    // The target is the chat whose card a person answered; the text and label say what they answered, written when they did.
    payload: z.object({ text: z.string(), label: z.string() })
});

/* A person's answer on a card the chat raised; one turn that wakes nobody, owed only through `OutboxLink.oweAnswer`. */
export const deliverAnswerKind = defineOutboxKind(DeliverAnswerSchema, {
    parked: { text: (entry, title, reason) => `The machine could not hand ${title} (${entry.target}) the answer a person gave on its card: ${reason}` }
});

const DeliverLostWorkSchema = z.object({
    kind: z.literal('deliver-lost-work'),
    // The target is an idle chat whose background commands a restart took; `noteId` is the note in its thread that says what was lost.
    payload: z.object({ noteId: z.string().min(1) })
});

/* One turn that tells an idle chat what a restart took, owed only through `OutboxLink.oweLostWork`. */
export const deliverLostWorkKind = defineOutboxKind(DeliverLostWorkSchema, {
    parked: { text: (entry, title, reason) => `The machine could not tell ${title} (${entry.target}) what a restart took: ${reason}` }
});
