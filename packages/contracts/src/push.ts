import { z } from 'zod';
import { PushHandleSchema } from '@ruimte/pulsar';

/*
 * What a device wants to hear of: an agent that needs a person (its approvals as well, while `approvals` is on),
 * a turn that finished, a process warning about a node. A subscription without `notify` hears of the first only.
 */
export const PushNotifyKindSchema = z.enum(['needs-you', 'turn', 'process']);
export type PushNotifyKind = z.infer<typeof PushNotifyKindSchema>;
export const PUSH_NOTIFY_DEFAULT: readonly PushNotifyKind[] = ['needs-you'];

/* The kinds for the nodes of one project, in place of the subscription's own `notify`; an empty list keeps the project quiet. */
export const PushProjectPreferenceSchema = z.object({
    projectId: z.string().min(1).max(256),
    notify: z.array(PushNotifyKindSchema).max(8)
});
export type PushProjectPreference = z.infer<typeof PushProjectPreferenceSchema>;

/* A newer app may name a kind this machine does not know; it is dropped instead of refusing the whole subscription. */
const PushNotifyWordsSchema = z
    .array(z.string().min(1).max(64))
    .max(32)
    .transform((words) => words.filter((word): word is PushNotifyKind => PushNotifyKindSchema.safeParse(word).success));

export const PushSubscribePayloadSchema = z.object({
    handle: PushHandleSchema,
    publicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    follow: z.array(z.string().min(1).max(256)).max(500),
    approvals: z.boolean(),
    readSync: z.boolean().optional(),
    followAll: z.boolean().optional(),
    activityScope: z.literal('machine').optional(),
    activities: z.boolean().optional(),
    activityNodeId: z.string().min(1).max(256).nullable().optional(),
    notify: PushNotifyWordsSchema.optional(),
    projects: z
        .array(PushProjectPreferenceSchema.extend({ notify: PushNotifyWordsSchema }))
        .max(500)
        .optional()
});
export type PushSubscribePayload = z.infer<typeof PushSubscribePayloadSchema>;
export const PushUnsubscribePayloadSchema = z.object({ handle: PushHandleSchema });

/* What the asking client's subscription on this machine applies, defaults filled in; `subscribed` false means it has none. */
export const PushPreferencesResultSchema = z.object({
    subscribed: z.boolean(),
    approvals: z.boolean(),
    notify: z.array(PushNotifyKindSchema),
    projects: z.array(PushProjectPreferenceSchema)
});
export type PushPreferencesResult = z.infer<typeof PushPreferencesResultSchema>;

export const PushAttentionEntrySchema = z.object({
    nodeId: z.string().min(1).max(256),
    issuedAt: z.number().int().nonnegative(),
    readThrough: z.number().int().nonnegative()
});
export type PushAttentionEntry = z.infer<typeof PushAttentionEntrySchema>;
export const PushAttentionResultSchema = z.object({
    entries: z.array(PushAttentionEntrySchema).max(1000),
    // When the machine started keeping entries a client may mark nodes from; what was issued before stays unmarked.
    marksFrom: z.number().int().nonnegative().optional()
});
export const PushReadPayloadSchema = PushAttentionEntrySchema.pick({ nodeId: true, issuedAt: true });
