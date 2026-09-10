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
