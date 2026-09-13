import { z } from 'zod';
import { SessionIdSchema } from './ids.ts';

// The agent CLIs Ruimte knows. Whether one has a chat backend or a hook normalizer is a capability
// on its provider, not a second list: a CLI without hooks still opens as a terminal agent.
export const AgentKindSchema = z.enum(['claude', 'codex', 'gemini', 'copilot']);
export type AgentKind = z.infer<typeof AgentKindSchema>;

// `exited` is the daemon's own reading, not a hook's: the CLI went down with its shell without
// ever reporting an end, so the node offers a resume instead of a status that stays on running.
export const AgentStatusSchema = z.enum(['running', 'needs-you', 'idle', 'error', 'exited']);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AgentInfoSchema = z.object({
    kind: AgentKindSchema,
    // The CLI's own session id, what `--resume` takes.
    agentSessionId: z.string().min(1),
    transcriptPath: z.string().nullable(),
    status: AgentStatusSchema,
    // False once the daemon came back after a restart: the CLI is gone but its session can be resumed.
    live: z.boolean(),
    updatedAt: z.number()
});
export type AgentInfo = z.infer<typeof AgentInfoSchema>;

export const SessionStatusEventSchema = z.object({
    sessionId: SessionIdSchema,
    agent: AgentInfoSchema.nullable()
});
export type SessionStatusEvent = z.infer<typeof SessionStatusEventSchema>;

export const AgentResumePayloadSchema = z.object({
    sessionId: SessionIdSchema
});
export type AgentResumePayload = z.infer<typeof AgentResumePayloadSchema>;

/*
 * One button under a permission request. `allow` and `deny` are always there; a `remember` choice
 * only exists when the CLI offered a rule to widen, and the daemon holds that rule rather than the
 * client, so a client never has to know a CLI's permission vocabulary.
 */
export const ApprovalChoiceSchema = z.object({
    id: z.string().min(1),
    kind: z.enum(['allow', 'remember', 'deny']),
    label: z.string().min(1)
});
export type ApprovalChoice = z.infer<typeof ApprovalChoiceSchema>;

/*
 * A permission the agent in a terminal is waiting on. The CLI is asking in its own TUI at the same
 * moment, so this is a second way to answer the same question, never the only one: whoever is first
 * wins and `expiresAt` is when the daemon stops holding and leaves the TUI to it.
 */
export const ApprovalRequestSchema = z.object({
    requestId: z.string().min(1),
    sessionId: SessionIdSchema,
    toolName: z.string().min(1),
    // The one line a person reads: the command for a shell call, the path for a file tool.
    summary: z.string(),
    choices: z.array(ApprovalChoiceSchema).min(1),
    createdAt: z.number(),
    expiresAt: z.number()
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

// The whole pending list of one session, so a client that arrives late and one that missed a settle agree.
export const SessionApprovalsEventSchema = z.object({
    sessionId: SessionIdSchema,
    approvals: z.array(ApprovalRequestSchema)
});
export type SessionApprovalsEvent = z.infer<typeof SessionApprovalsEventSchema>;

export const ApprovalAnswerPayloadSchema = z.object({
    sessionId: SessionIdSchema,
    requestId: z.string().min(1),
    choiceId: z.string().min(1)
});
export type ApprovalAnswerPayload = z.infer<typeof ApprovalAnswerPayloadSchema>;

// False when the request was already settled: another client was first, the person used the TUI, or it expired.
export const ApprovalAnswerResultSchema = z.object({
    accepted: z.boolean()
});
export type ApprovalAnswerResult = z.infer<typeof ApprovalAnswerResultSchema>;

/*
 * Whether this client offers permission requests to a person at all. One socket's answer, not the
 * daemon's: with it off the daemon holds nothing for this client, while a second client that still
 * wants them is asked as before. A client that never sends this wants them, which is what every
 * client written before the switch existed meant.
 */
export const ApprovalPreferencePayloadSchema = z.object({
    enabled: z.boolean()
});
export type ApprovalPreferencePayload = z.infer<typeof ApprovalPreferencePayloadSchema>;
