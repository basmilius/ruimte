import { z } from 'zod';

// How a client reaches a daemon; the loopback one is what the app starts with.
export const ReachabilitySchema = z.enum(['loopback', 'lan', 'tunnel', 'public']);
export type Reachability = z.infer<typeof ReachabilitySchema>;

export const EndpointInfoSchema = z.object({
    // The daemon's own id, minted once and kept in its home; a client keys a machine on this because an address moves.
    id: z.string().min(1),
    // The daemon's own name for itself, the machine's hostname unless configured.
    label: z.string(),
    platform: z.string(),
    version: z.string(),
    reachability: ReachabilitySchema,
    // False on a loopback connection, which needs no token.
    authenticated: z.boolean(),
    // The daemon's ed25519 public key, raw and base64url. Optional: a daemon from before this existed answers without one.
    publicKey: z.string().optional()
});
export type EndpointInfo = z.infer<typeof EndpointInfoSchema>;

// `POST /auth/pair`: a one-time pairing token from the daemon's printed URL, for a long-lived session token.
export const PairPayloadSchema = z.object({
    token: z.string().min(1),
    // What the daemon should call this client in its session list.
    label: z.string().min(1).max(80),
    // The client's ed25519 public key, raw and base64url. A client that cannot sign leaves it off and is given a session token instead.
    publicKey: z.string().optional()
});
export type PairPayload = z.infer<typeof PairPayloadSchema>;

export const PairResultSchema = z.object({
    // Only for a client that registered no public key; a key holder signs for a ticket per connection instead.
    sessionToken: z.string().min(1).optional(),
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

/*
 * `POST /auth/challenge`: the nonce a paired client signs to prove it holds its private key, and
 * the daemon's own signature over that nonce, which is what makes the daemon id a proof rather
 * than a string read off the wire.
 */
export const AuthChallengeResultSchema = z.object({
    challenge: z.string().min(1),
    daemon: z.object({
        id: z.string().min(1),
        publicKey: z.string().min(1),
        signature: z.string().min(1)
    })
});
export type AuthChallengeResult = z.infer<typeof AuthChallengeResultSchema>;

// `POST /auth/ticket`: a signed challenge, for a short-lived credential this one connection uses.
export const AuthTicketPayloadSchema = z.object({
    publicKey: z.string().min(1),
    challenge: z.string().min(1),
    signature: z.string().min(1)
});
export type AuthTicketPayload = z.infer<typeof AuthTicketPayloadSchema>;

export const AuthTicketResultSchema = z.object({
    ticket: z.string().min(1),
    // Milliseconds the ticket is good for, counted from the answer.
    expiresIn: z.number()
});
export type AuthTicketResult = z.infer<typeof AuthTicketResultSchema>;

// `auth.registerKey`: how a client paired before there were key pairs moves onto one without pairing again.
export const AuthRegisterKeyPayloadSchema = z.object({
    publicKey: z.string().min(1)
});
export type AuthRegisterKeyPayload = z.infer<typeof AuthRegisterKeyPayloadSchema>;

export const AuthRegisterKeyResultSchema = z.object({
    // False for a loopback client, which has no session record to hang a key on.
    registered: z.boolean()
});
export type AuthRegisterKeyResult = z.infer<typeof AuthRegisterKeyResultSchema>;

/*
 * The exact bytes both sides sign. The daemon id is in each one, so a signature collected by one
 * machine proves nothing to another, and the client's public key is in its own message, so a
 * challenge answered for one key cannot be handed in under another.
 */
export const daemonChallengeMessage = (daemonId: string, challenge: string): string => `ruimte-daemon-v1\n${daemonId}\n${challenge}`;

export const clientAuthMessage = (daemonId: string, challenge: string, publicKey: string): string =>
    `ruimte-client-v1\n${daemonId}\n${challenge}\n${publicKey}`;
