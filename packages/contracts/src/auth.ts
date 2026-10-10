import { BrokerSettingSchema, RegisterMachinePayloadSchema } from '@ruimte/pulsar';
import { z } from 'zod';
import { MachineUpdateSchema } from './machine-update.ts';
import { ProjectIconChoiceSchema } from './project.ts';
import { LanDoorSchema } from './lan-door.ts';
import { ProtocolVersionSchema } from './protocol.ts';
import { KeepAwakeModeSchema } from './keep-awake.ts';

// How a client reaches a daemon; the loopback one is what the app starts with.
export const ReachabilitySchema = z.enum(['loopback', 'lan', 'tunnel', 'public']);
export type Reachability = z.infer<typeof ReachabilitySchema>;

// Whether a person named this machine from a client, or it still answers to the name it started with.
export const EndpointNameSourceSchema = z.enum(['chosen', 'default']);
export type EndpointNameSource = z.infer<typeof EndpointNameSourceSchema>;

export { CLOSED_LID_BATTERY_FLOOR, KeepAwakeModeSchema, type KeepAwakeMode } from './keep-awake.ts';

export const EndpointInfoSchema = z.object({
    // The daemon's own id, minted once and kept in its home; a client keys a machine on this because an address moves.
    id: z.string().min(1),
    // What this machine is called: the name a person gave it, or `--label`, `RUIMTE_LABEL`, else its hostname.
    label: z.string(),
    // Which of the two the label is. Optional: a daemon from before a machine could be named answers without one.
    nameSource: EndpointNameSourceSchema.optional(),
    // The set a project and a view pick from; no image, since a machine has no folder to keep one in.
    // Null when nobody picked one, absent from a daemon without machine icons.
    icon: ProjectIconChoiceSchema.nullish(),
    // Lets `ruimte-context view delete` remove views an agent did not make. Enforced by the daemon, so it
    // lives in `endpoint.json`, not in a client's settings. Absent reads as false.
    agentsDeleteAnyView: z.boolean().optional(),
    // Turns away every statement from the address book. Kept in `endpoint.json`.
    refuseStatements: z.boolean().optional(),
    // Browser pages and device screens. Absent reads as true: an older daemon allowed browser streaming.
    streamingAllowed: z.boolean().optional(),
    // Lets a chat that stopped on a limit resume on a clock when its own switch allows. Absent reads as false.
    resumeAtReset: z.boolean().optional(),
    // `ruimte-context visual`. Off only when a person turned it off; absent from a daemon without visuals.
    visualReplies: z.boolean().optional(),
    appleFoundationEnabled: z.boolean().optional(),
    // The daemon holds the block, so it holds without a window and for a phone. An older daemon leaves
    // it out and its desktop app holds it per window.
    keepAwake: KeepAwakeModeSchema.optional(),
    // Hold the block on battery as well; off, it holds on the power adapter only.
    keepAwakeOnBattery: z.boolean().optional(),
    // Keep the display on too, only under `always`.
    keepAwakeDisplay: z.boolean().optional(),
    // Only macOS has a way to hold the block.
    keepAwakeAvailable: z.boolean().optional(),
    // Turns sleep off (`pmset disablesleep`) while the block holds: on the adapter, or on battery above
    // `CLOSED_LID_BATTERY_FLOOR` when the block may hold there.
    keepAwakeLidClosed: z.boolean().optional(),
    // Only a Mac offers the closed-lid mode.
    keepAwakeLidAvailable: z.boolean().optional(),
    // Without the sudoers rule the closed-lid switch does nothing. Only the local secret installs or
    // removes it (`endpoint.closedLidRule`).
    keepAwakeLidRule: z.boolean().optional(),
    // Of the desktop app. Changes come as `endpoint.updateChanged`, not `endpoint.changed`.
    update: MachineUpdateSchema.optional(),
    platform: z.string(),
    version: z.string(),
    // The wire version (`PROTOCOL_VERSION`). Absent from a daemon from before versions, which a client reads as older.
    protocol: ProtocolVersionSchema.optional(),
    reachability: ReachabilitySchema,
    // False for a client that presented the local secret, which has no paired session.
    authenticated: z.boolean(),
    // The daemon's ed25519 public key, raw and base64url. Optional: a daemon from before this existed answers without one.
    publicKey: z.string().optional(),
    // The effective broker a client signals a direct connection through: a flag or the environment, then
    // `broker`, then the build's default. Null when there is none.
    brokerUrl: z.string().nullish(),
    // A person's pick, kept in `endpoint.json`.
    broker: BrokerSettingSchema.optional(),
    // True when a flag or the environment decides the broker, so `broker` is kept but changes nothing.
    brokerFixed: z.boolean().optional(),
    // A client on the same network signals there before it tries the broker. Null while the door is closed.
    lan: LanDoorSchema.nullish(),
    // Kept in `endpoint.json`.
    lanDoor: z.boolean().optional(),
    // True when a flag decides the door, so `lanDoor` is kept but changes nothing.
    lanDoorFixed: z.boolean().optional(),
    // Null when on none. Only told to a client that presented the local secret.
    accountId: z.string().nullable().optional()
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
 * `endpoint.setIdentity`. Name and icon are always sent, since null is a choice: the default name, or no
 * icon. Every optional field left out leaves the machine as it stands.
 */
export const EndpointSetIdentityPayloadSchema = z.object({
    name: z.string().min(1).max(80).nullable(),
    icon: ProjectIconChoiceSchema.nullable(),
    agentsDeleteAnyView: z.boolean().optional(),
    refuseStatements: z.boolean().optional(),
    streamingAllowed: z.boolean().optional(),
    resumeAtReset: z.boolean().optional(),
    visualReplies: z.boolean().optional(),
    appleFoundationEnabled: z.boolean().optional(),
    keepAwake: KeepAwakeModeSchema.optional(),
    keepAwakeOnBattery: z.boolean().optional(),
    keepAwakeDisplay: z.boolean().optional(),
    // Turning it on is refused with `closed-lid-no-rule` while the rule is not installed; off always goes through.
    keepAwakeLidClosed: z.boolean().optional(),
    broker: BrokerSettingSchema.optional(),
    lanDoor: z.boolean().optional()
});
export type EndpointSetIdentityPayload = z.infer<typeof EndpointSetIdentityPayloadSchema>;

export const EndpointChangedEventSchema = z.object({
    id: z.string().min(1),
    label: z.string(),
    nameSource: EndpointNameSourceSchema,
    icon: ProjectIconChoiceSchema.nullable(),
    agentsDeleteAnyView: z.boolean().optional(),
    refuseStatements: z.boolean().optional(),
    streamingAllowed: z.boolean().optional(),
    resumeAtReset: z.boolean().optional(),
    visualReplies: z.boolean().optional(),
    appleFoundationEnabled: z.boolean().optional(),
    keepAwake: KeepAwakeModeSchema.optional(),
    keepAwakeOnBattery: z.boolean().optional(),
    keepAwakeDisplay: z.boolean().optional(),
    keepAwakeLidClosed: z.boolean().optional(),
    keepAwakeLidRule: z.boolean().optional(),
    broker: BrokerSettingSchema.optional(),
    brokerUrl: z.string().nullish(),
    brokerFixed: z.boolean().optional(),
    lan: LanDoorSchema.nullish(),
    lanDoor: z.boolean().optional(),
    lanDoorFixed: z.boolean().optional()
});
export type EndpointChangedEvent = z.infer<typeof EndpointChangedEventSchema>;

/*
 * `endpoint.closedLidRule`: the sudoers rule for exactly `pmset -a disablesleep 1` and `0`. Local secret
 * only; macOS asks for an administrator, so the request waits on a person. Removing turns sleep back on
 * and the switch off. Refused with `closed-lid-unavailable` off a Mac, `closed-lid-cancelled` on cancel.
 */
export const EndpointClosedLidRulePayloadSchema = z.object({
    install: z.boolean(),
    // The line macOS shows in its dialog, in the language of the asking client; left out, an English one.
    prompt: z.string().min(1).max(300).optional()
});
export type EndpointClosedLidRulePayload = z.infer<typeof EndpointClosedLidRulePayloadSchema>;

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

// `POST /auth/challenge`. The daemon's signature over the nonce makes its id a proof, not a string off the wire.
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
 * The daemon id in each message keeps a signature from proving anything to another machine, and the
 * client's key in its own keeps an answer for one key from being handed in under another.
 */
export function daemonChallengeMessage(daemonId: string, challenge: string): string {
    return `ruimte-daemon-v1\n${daemonId}\n${challenge}`;
}

export function clientAuthMessage(daemonId: string, challenge: string, publicKey: string): string {
    return `ruimte-client-v1\n${daemonId}\n${challenge}\n${publicKey}`;
}

/*
 * `endpoint.signRegistration`: the client posts the signed agreement with its own session; the daemon
 * holds no account token. Local secret only. Another account is refused with `machine-has-account`
 * until `endpoint.leaveAccount`.
 */
export const EndpointSignRegistrationPayloadSchema = z.object({
    accountId: z.string().min(1).max(64)
});
export type EndpointSignRegistrationPayload = z.infer<typeof EndpointSignRegistrationPayloadSchema>;

export const EndpointSignRegistrationResultSchema = z.object({
    registration: RegisterMachinePayloadSchema
});
export type EndpointSignRegistrationResult = z.infer<typeof EndpointSignRegistrationResultSchema>;

/*
 * `endpoint.leaveAccount`, local secret only. Every client a statement let in loses its access until the
 * machine signs for an account again.
 */
export const EndpointLeaveAccountResultSchema = z.object({
    revoked: z.number().int().min(0)
});
export type EndpointLeaveAccountResult = z.infer<typeof EndpointLeaveAccountResultSchema>;
