import { z } from 'zod';

// How a client reaches a daemon; the loopback one is what the app starts with.
export const ReachabilitySchema = z.enum(['loopback', 'lan', 'tunnel', 'public']);
export type Reachability = z.infer<typeof ReachabilitySchema>;

export const EndpointInfoSchema = z.object({
    // The daemon's own name for itself, the machine's hostname unless configured.
    label: z.string(),
    platform: z.string(),
    version: z.string(),
    reachability: ReachabilitySchema,
    // False on a loopback connection, which needs no token.
    authenticated: z.boolean()
});
export type EndpointInfo = z.infer<typeof EndpointInfoSchema>;

// `POST /auth/pair`: a one-time pairing token from the daemon's printed URL, for a long-lived session token.
export const PairPayloadSchema = z.object({
    token: z.string().min(1),
    // What the daemon should call this client in its session list.
    label: z.string().min(1).max(80)
});
export type PairPayload = z.infer<typeof PairPayloadSchema>;

export const PairResultSchema = z.object({
    sessionToken: z.string().min(1),
    endpoint: EndpointInfoSchema
});
export type PairResult = z.infer<typeof PairResultSchema>;

export const AuthSessionSchema = z.object({
    id: z.string().min(1),
    label: z.string(),
    createdAt: z.number(),
    lastSeenAt: z.number(),
    // The session the asking client itself holds.
    current: z.boolean()
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;

export const AuthSessionsResultSchema = z.object({
    sessions: z.array(AuthSessionSchema)
});
export type AuthSessionsResult = z.infer<typeof AuthSessionsResultSchema>;

export const AuthRevokePayloadSchema = z.object({
    id: z.string().min(1)
});
export type AuthRevokePayload = z.infer<typeof AuthRevokePayloadSchema>;

// `auth.pairingToken`: a fresh pairing URL, minted for the client on the daemon's own machine.
export const PairingTokenResultSchema = z.object({
    url: z.string().min(1)
});
export type PairingTokenResult = z.infer<typeof PairingTokenResultSchema>;
