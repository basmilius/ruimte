import { z } from 'zod';
import { SessionIdSchema } from './ids.ts';

// The CLIs whose hooks the daemon understands. Others join as one more entry plus one normalizer.
export const AgentKindSchema = z.enum(['claude', 'codex']);
export type AgentKind = z.infer<typeof AgentKindSchema>;

export const AgentStatusSchema = z.enum(['running', 'needs-you', 'idle', 'error']);
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
