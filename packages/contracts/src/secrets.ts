import { EmptySchema } from '@adecore/agent-contracts/protocol';
import { z } from 'zod';

/*
 * The value of a launch's variable that stands for a secret this machine keeps under `$RUIMTE_HOME`.
 * Only the daemon swaps it for the secret, and only in the environment of the process it starts, so
 * the launch files, an approval and every client see this marker and never the value.
 */
export const LAUNCH_SECRET_REFERENCE = 'ruimte:secret';

export function isSecretReference(value: string | undefined): boolean {
    return value === LAUNCH_SECRET_REFERENCE;
}

/* A variable name a shell can export. */
export const SECRET_VARIABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const SECRET_LIMITS = {
    variable: 128,
    label: 120,
    reason: 600,
    placeholder: 120,
    url: 2048,
    fields: 6,
    // Generous for a token or a key pair, small enough that nobody pastes a file by mistake.
    value: 16_384
} as const;

/* The page a card offers to open, or null for anything that is not an http(s) address with a host. */
export function secretPageUrl(value: string): URL | null {
    try {
        const url = new URL(value);

        return (url.protocol === 'https:' || url.protocol === 'http:') && url.host !== '' ? url : null;
    } catch {
        return null;
    }
}

/*
 * Where a saved value goes: `launch` binds it to a variable of a launch, which only that process gets;
 * `file` writes it to a private file the asking agent's own commands read, which the agent can see.
 */
export const SecretDeliverySchema = z.enum(['launch', 'file']);
export type SecretDelivery = z.infer<typeof SecretDeliverySchema>;

/* One of several values a card asks for at once, such as a user name beside its password. */
export const SecretFieldSchema = z.object({
    name: z.string().min(1),
    label: z.string(),
    placeholder: z.string().optional(),
    // False for a value that is no secret, such as a user name, which the field then shows as typed.
    masked: z.boolean().optional()
});
export type SecretField = z.infer<typeof SecretFieldSchema>;

/* An agent asking a person for a secret, as the card in its chat shows it. */
export const SecretRequestSchema = z.object({
    requestId: z.string().min(1),
    // The chat that asks, by the id of its node or view.
    nodeId: z.string().min(1),
    projectId: z.string().min(1),
    // Absent is `launch`, as every card of a machine from before files was.
    delivery: SecretDeliverySchema.optional(),
    // The launch and its variable, for a `launch` card only.
    launchId: z.string().min(1).optional(),
    launchName: z.string().optional(),
    variable: z.string().min(1).optional(),
    label: z.string(),
    reason: z.string(),
    placeholder: z.string().optional(),
    // The page where the person finds or makes the value; an http(s) address.
    url: z.string().optional(),
    // Several values in one card; absent asks for one.
    fields: z.array(SecretFieldSchema).optional(),
    // Whether the launch holds a secret under this variable already, which a save replaces.
    replaces: z.boolean(),
    createdAt: z.number(),
    // When the card goes if nobody answers; every call of the agent for the same variable moves it on.
    expiresAt: z.number()
});
export type SecretRequest = z.infer<typeof SecretRequestSchema>;

// Every card of the machine at once, so a client that arrives late and one that missed a settle agree.
export const SecretRequestsSchema = z.object({
    requests: z.array(SecretRequestSchema)
});
export type SecretRequests = z.infer<typeof SecretRequestsSchema>;

// `value` answers a card with one field, `values` one with `fields`, by field name; the machine refuses a mix.
export const SecretSavePayloadSchema = z.object({
    requestId: z.string().min(1),
    value: z.string().min(1).max(SECRET_LIMITS.value).optional(),
    values: z.record(z.string(), z.string().min(1).max(SECRET_LIMITS.value)).optional()
});
export type SecretSavePayload = z.infer<typeof SecretSavePayloadSchema>;

export const SecretDeclinePayloadSchema = z.object({
    requestId: z.string().min(1)
});

// False when the card was gone already: another client was first, the turn ended or it expired.
export const SecretAnswerResultSchema = z.object({
    accepted: z.boolean()
});

export const SECRETS_REQUEST_SCHEMAS = {
    'secret.requests': { payload: EmptySchema, result: SecretRequestsSchema },
    'secret.save': { payload: SecretSavePayloadSchema, result: SecretAnswerResultSchema },
    'secret.decline': { payload: SecretDeclinePayloadSchema, result: SecretAnswerResultSchema }
} as const;

export const SECRETS_EVENT_SCHEMAS = {
    'secret.requests': SecretRequestsSchema
} as const;
