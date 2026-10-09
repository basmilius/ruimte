import { z } from 'zod';
import { SessionIdSchema } from './ids.ts';

export const SessionPortSchema = z.object({
    pid: z.number().int().positive(),
    startTime: z.number().int().positive(),
    port: z.number().int().min(1).max(65535),
    host: z.enum(['127.0.0.1', '[::1]']),
    bindAddress: z.string().min(1).optional()
});
export type SessionPort = z.infer<typeof SessionPortSchema>;

export const SessionPortsResultSchema = z.discriminatedUnion('status', [
    z.object({ status: z.literal('ready'), ports: z.array(SessionPortSchema).max(128) }),
    z.object({ status: z.literal('unknown') }),
    z.object({ status: z.literal('unavailable') }),
    z.object({ status: z.literal('closed') })
]);
export type SessionPortsResult = z.infer<typeof SessionPortsResultSchema>;

export const SessionPortVerifyPayloadSchema = z.object({ sessionId: SessionIdSchema, listener: SessionPortSchema });
export const SESSION_PORT_VERIFY_MAX_AGE_MS = 5000;
export const SessionPortVerifyResultSchema = z.object({
    url: z.string().url(),
    machineId: z.string().min(1).optional(),
    validForMs: z.number().int().positive().max(SESSION_PORT_VERIFY_MAX_AGE_MS).optional()
});
export type SessionPortVerification = z.infer<typeof SessionPortVerifyResultSchema>;
