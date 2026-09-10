import { z } from 'zod';
import { AgentInfoSchema, AgentKindSchema } from './agent.ts';
import { SessionIdSchema } from './ids.ts';
import { RuntimeModeSchema } from './model.ts';

// An agent CLI to start in a fresh shell. The daemon owns the command line, so every client
// launches a CLI the same way and a new flag never has to travel over the wire.
export const AgentLaunchSchema = z.object({
    kind: AgentKindSchema,
    // Ruimte's own permission vocabulary; each CLI's launcher maps it to its flags.
    runtimeMode: RuntimeModeSchema.optional(),
    model: z.string().min(1).optional(),
    // The CLI's own session id, to continue that conversation instead of starting one.
    resume: z.string().min(1).optional()
});
export type AgentLaunch = z.infer<typeof AgentLaunchSchema>;

const cols = z.number().int().positive();
const rows = z.number().int().positive();

export const SessionInfoSchema = z.object({
    sessionId: SessionIdSchema,
    cwd: z.string(),
    pid: z.number().int(),
    cols,
    rows,
    createdAt: z.number(),
    attached: z.number().int().nonnegative(),
    exited: z.boolean(),
    // Only present once the shell has ended; a signal death is reported shell-style as 128 plus the signal number.
    exitCode: z.number().int().optional(),
    // The agent CLI last seen in this shell, if any.
    agent: AgentInfoSchema.nullable().optional()
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

export const SessionCreatePayloadSchema = z.object({
    sessionId: SessionIdSchema,
    cwd: z.string().optional(),
    cols,
    rows,
    shell: z.string().optional(),
    // Typed into the fresh shell as its first line, so a node can open straight into a program.
    command: z.string().optional(),
    // An agent CLI to start instead; the daemon builds its command line and types that.
    agent: AgentLaunchSchema.optional()
});
export type SessionCreatePayload = z.infer<typeof SessionCreatePayloadSchema>;

export const SessionAttachPayloadSchema = z.object({
    sessionId: SessionIdSchema,
    cols,
    rows
});
export type SessionAttachPayload = z.infer<typeof SessionAttachPayloadSchema>;

export const SessionAttachResultSchema = z.object({
    screen: z.string(),
    cols,
    rows,
    exited: z.boolean()
});
export type SessionAttachResult = z.infer<typeof SessionAttachResultSchema>;

export const SessionTargetPayloadSchema = z.object({
    sessionId: SessionIdSchema
});
export type SessionTargetPayload = z.infer<typeof SessionTargetPayloadSchema>;

export const SessionWritePayloadSchema = z.object({
    sessionId: SessionIdSchema,
    data: z.string()
});
export type SessionWritePayload = z.infer<typeof SessionWritePayloadSchema>;

export const SessionResizePayloadSchema = z.object({
    sessionId: SessionIdSchema,
    cols,
    rows
});
export type SessionResizePayload = z.infer<typeof SessionResizePayloadSchema>;

export const SessionListResultSchema = z.object({
    sessions: z.array(SessionInfoSchema)
});
export type SessionListResult = z.infer<typeof SessionListResultSchema>;

export const SessionOutputEventSchema = z.object({
    sessionId: SessionIdSchema,
    data: z.string()
});
export type SessionOutputEvent = z.infer<typeof SessionOutputEventSchema>;

export const SessionExitEventSchema = z.object({
    sessionId: SessionIdSchema,
    exitCode: z.number().int()
});
export type SessionExitEvent = z.infer<typeof SessionExitEventSchema>;

// Sent instead of the output a slow client missed: the daemon owns the screen, so it can hand
// out a fresh one and continue the stream from there.
export const SessionResyncEventSchema = z.object({
    sessionId: SessionIdSchema,
    screen: z.string()
});
export type SessionResyncEvent = z.infer<typeof SessionResyncEventSchema>;
