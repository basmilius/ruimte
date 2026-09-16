import { z } from 'zod';
import { PushHandleSchema } from '@ruimte/pulsar';

export const PushSubscribePayloadSchema = z.object({
    handle: PushHandleSchema,
    publicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    follow: z.array(z.string().min(1).max(256)).max(500),
    approvals: z.boolean(),
    readSync: z.boolean().optional(),
    followAll: z.boolean().optional(),
    activityScope: z.literal('machine').optional(),
    activities: z.boolean().optional(),
    activityNodeId: z.string().min(1).max(256).nullable().optional()
});
export type PushSubscribePayload = z.infer<typeof PushSubscribePayloadSchema>;
export const PushUnsubscribePayloadSchema = z.object({ handle: PushHandleSchema });

export const PushAttentionEntrySchema = z.object({
    nodeId: z.string().min(1).max(256),
    issuedAt: z.number().int().nonnegative(),
    readThrough: z.number().int().nonnegative()
});
export type PushAttentionEntry = z.infer<typeof PushAttentionEntrySchema>;
export const PushAttentionResultSchema = z.object({ entries: z.array(PushAttentionEntrySchema).max(1000) });
export const PushReadPayloadSchema = PushAttentionEntrySchema.pick({ nodeId: true, issuedAt: true });
