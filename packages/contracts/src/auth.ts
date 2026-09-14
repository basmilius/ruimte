import { RegisterMachinePayloadSchema } from '@ruimte/pulsar';
import { z } from 'zod';
import { ProjectIconChoiceSchema } from './project.ts';

// How a client reaches a daemon; the loopback one is what the app starts with.
export const ReachabilitySchema = z.enum(['loopback', 'lan', 'tunnel', 'public']);
export type Reachability = z.infer<typeof ReachabilitySchema>;

// Whether a person named this machine from a client, or it still answers to the name it started with.
export const EndpointNameSourceSchema = z.enum(['chosen', 'default']);
export type EndpointNameSource = z.infer<typeof EndpointNameSourceSchema>;

export const EndpointInfoSchema = z.object({
    // The daemon's own id, minted once and kept in its home; a client keys a machine on this because an address moves.
    id: z.string().min(1),
    // What this machine is called: the name a person gave it, or `--label`, `RUIMTE_LABEL`, else its hostname.
    label: z.string(),
    // Which of the two the label is. Optional: a daemon from before a machine could be named answers without one.
    nameSource: EndpointNameSourceSchema.optional(),
    /* The icon a person picked for this machine, from the same closed set a project and a view pick
       from, so one renderer in the client covers all three. Null when nobody picked one, absent
       from a daemon that knows nothing of machine icons. An image is not among the kinds: a machine
       has no folder to keep one in. */
    icon: ProjectIconChoiceSchema.nullish(),
    /* Whether an agent's `ruimte-context view delete` may remove any view of a project on this
       machine, instead of only the views it made itself. The daemon enforces it, so it lives in
       `endpoint.json` and not in a client's settings; a client only shows what it stands at.
       Absent from a daemon that predates the canvas view verbs, which is the same as false. */
    agentsDeleteAnyView: z.boolean().optional(),
    /* Whether this machine turns away every statement from the address book, so a pairing link is
       the only way in. Enforced by the daemon, kept in `endpoint.json`. Absent from a daemon from
       before statements, which takes none anyway. */
    refuseStatements: z.boolean().optional(),
    platform: z.string(),
    version: z.string(),
    reachability: ReachabilitySchema,
    // False for a client that presented the local secret, which has no paired session.
    authenticated: z.boolean(),
    // The daemon's ed25519 public key, raw and base64url. Optional: a daemon from before this existed answers without one.
    publicKey: z.string().optional(),
    /* The Pulsar broker this machine announces itself to, which a client dials to signal a direct
       connection without reaching the machine's own address. Null when it has none, absent from a
       daemon from before the broker. */
    brokerUrl: z.string().nullish()
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

/*
 * `endpoint.setIdentity`: what this machine calls itself, set from any client that paired with it,
 * so every client sees the same name and icon. Both fields are always sent, since a null is a
 * choice of its own: it hands the machine back to the name it starts with, or leaves it iconless.
 */
export const EndpointSetIdentityPayloadSchema = z.object({
    name: z.string().min(1).max(80).nullable(),
    icon: ProjectIconChoiceSchema.nullable(),
    /* What an agent may delete, set from the same pane. Optional rather than nullable: the dialog
       that names a machine does not touch it, so leaving it out leaves the machine as it stands. */
    agentsDeleteAnyView: z.boolean().optional(),
    // Whether statements from the address book are turned away; left out, the machine stays as it stands.
    refuseStatements: z.boolean().optional()
});
export type EndpointSetIdentityPayload = z.infer<typeof EndpointSetIdentityPayloadSchema>;

// A client named this machine or gave it another icon; every other client redraws the row it keeps.
export const EndpointChangedEventSchema = z.object({
    id: z.string().min(1),
    label: z.string(),
    nameSource: EndpointNameSourceSchema,
    icon: ProjectIconChoiceSchema.nullable(),
    agentsDeleteAnyView: z.boolean().optional(),
    refuseStatements: z.boolean().optional()
});
export type EndpointChangedEvent = z.infer<typeof EndpointChangedEventSchema>;

/* How a client got its access: a pairing link a person handed over, or a statement from the address
   book that it is signed in to the same account as the machine. */
export const PairingOriginSchema = z.enum(['link', 'statement']);
export type PairingOrigin = z.infer<typeof PairingOriginSchema>;

export const AuthSessionSchema = z.object({
    id: z.string().min(1),
    label: z.string(),
    // Optional: a daemon from before statements answers without one, and all of its clients came in on a link.
    origin: PairingOriginSchema.optional(),
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

// `auth.pairingToken`: a fresh pairing URL, minted only for a client that presented the local secret.
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
    // False for a client on the local secret, which has no session record to hang a key on.
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

/*
 * `endpoint.signRegistration`: the daemon's agreement to join one address book account, which the
 * client posts to the address book with its own session. The daemon signs and holds no account token,
 * so a machine is only ever on an account a client it already trusts asked for.
 */
export const EndpointSignRegistrationPayloadSchema = z.object({
    accountId: z.string().min(1).max(64)
});
export type EndpointSignRegistrationPayload = z.infer<typeof EndpointSignRegistrationPayloadSchema>;

export const EndpointSignRegistrationResultSchema = z.object({
    registration: RegisterMachinePayloadSchema
});
export type EndpointSignRegistrationResult = z.infer<typeof EndpointSignRegistrationResultSchema>;
