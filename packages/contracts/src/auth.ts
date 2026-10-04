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
    /* Whether the daemon lets clients stream browser pages and device screens. Absent from an older
       daemon, which allowed browser streaming and therefore behaves like true. */
    streamingAllowed: z.boolean().optional(),
    /* Whether the daemon may take up a chat that stopped on a limit on a clock, when the chat's own
       switch lets it. Absent from an older daemon, which never does. */
    resumeAtReset: z.boolean().optional(),
    appleFoundationEnabled: z.boolean().optional(),
    /* Whether the machine keeps itself from sleeping. The daemon holds the block, so it holds without a
       window open and for a phone. Absent from an older daemon, whose desktop app still holds it per window. */
    keepAwake: KeepAwakeModeSchema.optional(),
    // Hold the block on battery as well; off, it holds on the power adapter only.
    keepAwakeOnBattery: z.boolean().optional(),
    // Keep the display on too, only under `always`.
    keepAwakeDisplay: z.boolean().optional(),
    // Whether this machine can hold the block at all; false where the daemon has no way to (only macOS has one).
    keepAwakeAvailable: z.boolean().optional(),
    /* Keep the Mac awake with its lid closed too, by turning sleep off (`pmset disablesleep`) while the
       block holds: on the power adapter, or on battery above `CLOSED_LID_BATTERY_FLOOR` when the block
       may hold there. Absent from an older daemon. */
    keepAwakeLidClosed: z.boolean().optional(),
    // Whether this machine offers the closed-lid mode at all; only a Mac does.
    keepAwakeLidAvailable: z.boolean().optional(),
    /* Whether Ruimte's sudoers rule is installed, without which the daemon cannot turn sleep off and the
       switch does nothing. Only the local secret installs or removes it (`endpoint.closedLidRule`). */
    keepAwakeLidRule: z.boolean().optional(),
    /* Where the update of the desktop app on this machine stands. Absent from an older daemon. Changes
       come as `endpoint.updateChanged`, not `endpoint.changed`, which every client answers by asking again. */
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
    /* The Pulsar broker this machine announces itself to, which a client dials to signal a direct
       connection without reaching the machine's own address. Null when it has none, absent from a
       daemon from before the broker. It follows the effective broker: a flag or the environment, then
       `broker` below, then the build's default. */
    brokerUrl: z.string().nullish(),
    /* The broker a person picked for this machine, kept in `endpoint.json`. Absent from a daemon from
       before the setting. */
    broker: BrokerSettingSchema.optional(),
    // True when a flag or the environment decides the broker, so `broker` is kept but changes nothing.
    brokerFixed: z.boolean().optional(),
    /* Where the machine's door on the local network listens right now, so a client on the same network
       signals a direct connection there before it tries the broker. The addresses are read from the
       interfaces when asked. Null while the door is closed, absent from a daemon from before the door. */
    lan: LanDoorSchema.nullish(),
    // Whether a person keeps the door open, kept in `endpoint.json`; absent from a daemon from before the door.
    lanDoor: z.boolean().optional(),
    // True when a flag decides the door, so `lanDoor` is kept but changes nothing.
    lanDoorFixed: z.boolean().optional(),
    /* The address book account this machine is on, null when it is on none. Only a client that presented
       the local secret is told; absent for any other, and from a daemon from before a machine had one account. */
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
    refuseStatements: z.boolean().optional(),
    // Whether browser and device streaming is allowed; left out, the machine stays as it stands.
    streamingAllowed: z.boolean().optional(),
    // Whether a limited chat may be taken up on a clock; left out, the machine stays as it stands.
    resumeAtReset: z.boolean().optional(),
    appleFoundationEnabled: z.boolean().optional(),
    // When the machine keeps itself awake, and how; each left out stays as it stands.
    keepAwake: KeepAwakeModeSchema.optional(),
    keepAwakeOnBattery: z.boolean().optional(),
    keepAwakeDisplay: z.boolean().optional(),
    // Turning it on is refused with `closed-lid-no-rule` while the rule is not installed; off always goes through.
    keepAwakeLidClosed: z.boolean().optional(),
    // Which broker the machine announces itself to; left out, the machine stays on the one it has.
    broker: BrokerSettingSchema.optional(),
    // Whether the door on the local network stays open; left out, the machine stays as it stands.
    lanDoor: z.boolean().optional()
});
export type EndpointSetIdentityPayload = z.infer<typeof EndpointSetIdentityPayloadSchema>;

// A client named this machine or gave it another icon; every other client redraws the row it keeps.
export const EndpointChangedEventSchema = z.object({
    id: z.string().min(1),
    label: z.string(),
    nameSource: EndpointNameSourceSchema,
    icon: ProjectIconChoiceSchema.nullable(),
    agentsDeleteAnyView: z.boolean().optional(),
    refuseStatements: z.boolean().optional(),
    streamingAllowed: z.boolean().optional(),
    resumeAtReset: z.boolean().optional(),
    appleFoundationEnabled: z.boolean().optional(),
    keepAwake: KeepAwakeModeSchema.optional(),
    keepAwakeOnBattery: z.boolean().optional(),
    keepAwakeDisplay: z.boolean().optional(),
    keepAwakeLidClosed: z.boolean().optional(),
    // The rule came or went, so a phone shows the closed-lid switch as usable or not without asking again.
    keepAwakeLidRule: z.boolean().optional(),
    broker: BrokerSettingSchema.optional(),
    // What the machine hands clients as its broker now, so a client follows a change without asking again.
    brokerUrl: z.string().nullish(),
    brokerFixed: z.boolean().optional(),
    lan: LanDoorSchema.nullish(),
    lanDoor: z.boolean().optional(),
    lanDoorFixed: z.boolean().optional()
});
export type EndpointChangedEvent = z.infer<typeof EndpointChangedEventSchema>;

/*
 * `endpoint.closedLidRule`: installs or removes the sudoers rule that lets the daemon run exactly
 * `pmset -a disablesleep 1` and `0` without a password. Local secret only; the daemon asks macOS for an
 * administrator through its own dialog, so the request waits on a person. Removing turns sleep back on
 * and the closed-lid switch off. Refused with `closed-lid-unavailable` off a Mac and with
 * `closed-lid-cancelled` when the person cancels the dialog.
 */
export const EndpointClosedLidRulePayloadSchema = z.object({
    install: z.boolean(),
    // The line macOS shows in its dialog, in the language of the asking client; left out, an English one.
    prompt: z.string().min(1).max(300).optional()
});
export type EndpointClosedLidRulePayload = z.infer<typeof EndpointClosedLidRulePayloadSchema>;

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
 * client posts to the address book with its own session. The daemon signs and holds no account token.
 * Only a client that presented the local secret may ask, signing puts the machine on that account,
 * and another account is refused with `machine-has-account` until `endpoint.leaveAccount`.
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
 * `endpoint.leaveAccount`: a person on this machine takes it off its account, from a client that presented
 * the local secret. Every client a statement let in loses its access, and no statement lets one in until
 * the machine signs for an account again.
 */
export const EndpointLeaveAccountResultSchema = z.object({
    // How many clients lost their access.
    revoked: z.number().int().min(0)
});
export type EndpointLeaveAccountResult = z.infer<typeof EndpointLeaveAccountResultSchema>;
