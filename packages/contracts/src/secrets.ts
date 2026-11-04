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
    // Generous for a token or a key pair, small enough that nobody pastes a file by mistake.
    value: 16_384
} as const;

/* An agent asking a person for the value of a launch's variable, as the card in its chat shows it. */
export const SecretRequestSchema = z.object({
    requestId: z.string().min(1),
    // The chat that asks, by the id of its node or view.
    nodeId: z.string().min(1),
    projectId: z.string().min(1),
    launchId: z.string().min(1),
    launchName: z.string(),
    variable: z.string().min(1),
    label: z.string(),
    reason: z.string(),
    placeholder: z.string().optional(),
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

export const SecretSavePayloadSchema = z.object({
    requestId: z.string().min(1),
    value: z.string().min(1).max(SECRET_LIMITS.value)
});

export const SecretDeclinePayloadSchema = z.object({
    requestId: z.string().min(1)
});

// False when the card was gone already: another client was first, the turn ended or it expired.
export const SecretAnswerResultSchema = z.object({
    accepted: z.boolean()
});
