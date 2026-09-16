import { z } from 'zod';
import { MachineIdSchema } from './keys.ts';

const token = z.string().regex(/^[a-fA-F0-9]{32,512}$/);
const key = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const PushHandleSchema = key;
export const RuimteActivityAttributesSchema = z.object({ machineId: MachineIdSchema, collapseId: key });
export const PushRegisterDevicePayloadSchema = z.object({ token, environment: z.enum(['sandbox', 'production']) });
export const PushRegisterDeviceResultSchema = z.object({ handle: PushHandleSchema });
export const PushActivityRegistrationSchema = z.object({
    machineId: MachineIdSchema,
    collapseId: key,
    token: token.nullable(),
    reserve: z.boolean().optional(),
    release: z.boolean().optional()
});
export const PushStartActivityRegistrationSchema = z.object({
    token: token.nullable(),
    scope: z.literal('machines').optional(),
    machineId: MachineIdSchema.nullable().optional(),
    collapseId: key.nullable().optional()
});
export type PushRegisterDevicePayload = z.infer<typeof PushRegisterDevicePayloadSchema>;

export const PushAlertContentSchema = z.object({
    kind: z.enum(['turn', 'attention', 'approval']),
    target: z.enum(['terminal', 'chat']),
    nodeId: z.string().min(1).max(256),
    title: z.string().max(160),
    body: z.string().max(500),
    requestId: z.string().max(256).optional(),
    choices: z
        .array(z.object({ id: z.string().max(256), kind: z.enum(['allow', 'remember', 'deny']), label: z.string().max(80) }))
        .max(8)
        .optional(),
    expiresAt: z.number().int().nonnegative()
});
export type PushAlertContent = z.infer<typeof PushAlertContentSchema>;

export const PushActivityContentSchema = z.object({
    title: z.string().max(160),
    phase: z.enum(['running', 'tool', 'needs-you', 'done']),
    startedAt: z.number().int().nonnegative(),
    runningCount: z.number().int().nonnegative().optional(),
    attentionCount: z.number().int().nonnegative().optional()
});
export type PushActivityContent = z.infer<typeof PushActivityContentSchema>;

export const PushRoutingSchema = z.object({
    machineId: MachineIdSchema,
    handle: PushHandleSchema,
    id: key,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    collapseId: key
});
export type PushRouting = z.infer<typeof PushRoutingSchema>;

export const PushEnvelopeSchema = z.discriminatedUnion('pushType', [
    PushRoutingSchema.extend({
        pushType: z.literal('alert'),
        ephemeralKey: key,
        nonce: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
        // Ciphertext followed by the 16-byte AES-GCM tag; the nonce travels separately.
        ciphertext: z
            .string()
            .regex(/^[A-Za-z0-9_-]+$/)
            .min(22)
            .max(3200),
        signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/)
    }),
    PushRoutingSchema.extend({
        pushType: z.literal('liveactivity'),
        activity: PushActivityContentSchema,
        signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/)
    })
]);
export type PushEnvelope = z.infer<typeof PushEnvelopeSchema>;

export const MACHINE_ACTIVITY_NODE = '__ruimte_machine_activity__';
export const PUSH_MAX_AGE_MS = 120_000;
export const PUSH_MAX_CLOCK_SKEW_MS = 30_000;
export const PUSH_HKDF_SALT = 'pulsar-push-encryption-v1';
export const pushCollapseIdMessage = (machineId: string, nodeId: string): string => JSON.stringify([machineId, nodeId]);
export const pushEncryptionInfo = (machineId: string, handle: string): string => JSON.stringify([machineId, handle]);
export const pushRoutingMessage = (push: PushRouting): string =>
    `pulsar-push-routing-v1\n${JSON.stringify([push.machineId, push.handle, push.id, push.issuedAt, push.expiresAt, push.collapseId])}`;
export const pushMessage = (push: PushEnvelope): string => {
    const body: (string | number | null)[] =
        push.pushType === 'alert' ? [push.ephemeralKey, push.nonce, push.ciphertext] : [push.activity.title, push.activity.phase, push.activity.startedAt];
    if (push.pushType === 'liveactivity' && (push.activity.runningCount !== undefined || push.activity.attentionCount !== undefined)) {
        body.push(push.activity.runningCount ?? null, push.activity.attentionCount ?? null);
    }
    return `pulsar-push-v1\n${JSON.stringify([push.machineId, push.handle, push.id, push.issuedAt, push.expiresAt, push.collapseId, push.pushType, ...body])}`;
};
