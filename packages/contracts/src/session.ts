import { z } from 'zod';
import { AgentInfoSchema } from './agent.ts';
import { SessionIdSchema } from './ids.ts';

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
    command: z.string().optional()
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
