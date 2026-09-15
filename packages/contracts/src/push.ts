import { z } from 'zod';
import { PushHandleSchema } from '@ruimte/pulsar';

export const PushSubscribePayloadSchema = z.object({
    handle: PushHandleSchema,
    publicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    follow: z.array(z.string().min(1).max(256)).max(500),
    approvals: z.boolean(),
    activities: z.boolean().optional()
});
export type PushSubscribePayload = z.infer<typeof PushSubscribePayloadSchema>;
export const PushUnsubscribePayloadSchema = z.object({ handle: PushHandleSchema });
