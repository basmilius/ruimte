import {
    BrokerSettingSchema,
    MachineIdSchema,
    NonceSchema,
    PublicKeySchema,
    RegisterMachinePayloadSchema,
    SignatureSchema,
    USAGE_CLIENT_COUNTERS,
    USAGE_CLIENT_TIMINGS,
    USAGE_MAX_STARTUP_MS
} from '@ruimte/pulsar';
import { z } from 'zod';
import { MachineUpdateSchema } from './machine-update.ts';
import { NodeKindSchema, ProjectIconChoiceSchema } from './project.ts';
import { NODE_SIZE_MAX, NODE_SIZE_MIN } from './node-defaults.ts';
import { LanDoorSchema } from './lan-door.ts';
import { ProtocolVersionSchema } from './protocol.ts';
import { KeepAwakeModeSchema } from './keep-awake.ts';
import { AgentIntegrationsSummarySchema } from './agent-integrations.ts';

// How a client reaches a daemon; the loopback one is what the app starts with.
export const ReachabilitySchema = z.enum(['loopback', 'lan', 'tunnel', 'public']);
export type Reachability = z.infer<typeof ReachabilitySchema>;

// Whether a person named this machine from a client, or it still answers to the name it started with.
export const EndpointNameSourceSchema = z.enum(['chosen', 'default']);
export type EndpointNameSource = z.infer<typeof EndpointNameSourceSchema>;

export { CLOSED_LID_BATTERY_FLOOR, KeepAwakeModeSchema, type KeepAwakeMode } from './keep-awake.ts';

/*
 * The sizes a person gave new nodes on a machine, by kind; a kind left out takes its built-in size.
 * Open on purpose: a newer machine may name a kind or allow a size an older client never heard of,
 * and a client that validates the whole reply must not refuse the machine over it.
 */
export const EndpointNodeSizesSchema = z.record(z.string(), z.object({ w: z.number(), h: z.number() }));

/* The switches a person sets on a machine, which its info, its settings and its change event all carry. */
const MACHINE_SWITCHES = {
    // Lets `ruimte-context view delete` remove views an agent did not make. Enforced by the daemon, so it
    // lives in `endpoint.json`, not in a client's settings. Absent reads as false.
    agentsDeleteAnyView: z.boolean().optional(),
    // Lets an agent read the other projects open on this machine and start agents there (`--project`). Enforced
    // by the daemon, so it lives in `endpoint.json`. Absent reads as false.
    reachOpenProjects: z.boolean().optional(),
    // Browser pages and device screens. Absent reads as true.
    streamingAllowed: z.boolean().optional(),
    // Lets a chat that stopped on a limit resume on a clock when its own switch allows. Absent reads as false.
    resumeAtReset: z.boolean().optional(),
    // `ruimte-context visual`. Off only when a person turned it off; absent reads as on.
    visualReplies: z.boolean().optional(),
    appleFoundationEnabled: z.boolean().optional(),
    // The daemon holds the block, so it holds without a window and for a phone. Absent reads as off.
    keepAwake: KeepAwakeModeSchema.optional(),
    // Hold the block on battery as well; off, it holds on the power adapter only.
    keepAwakeOnBattery: z.boolean().optional(),
    // Keep the display on too, only under `always`.
    keepAwakeDisplay: z.boolean().optional()
};

export const EndpointInfoSchema = z.object({
    // The daemon's own id, minted once and kept in its home; a client keys a machine on this because an address moves.
    id: z.string().min(1),
    // What this machine is called: the name a person gave it, or `--label`, `RUIMTE_LABEL`, else its hostname.
    label: z.string(),
    // Which of the two the label is. Absent reads as `default`.
    nameSource: EndpointNameSourceSchema.optional(),
    // The set a project and a view pick from; no image, since a machine has no folder to keep one in.
    // Null or absent when nobody picked one.
    icon: ProjectIconChoiceSchema.nullish(),
    ...MACHINE_SWITCHES,
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
    // The daemon's ed25519 public key, raw and base64url. Only `endpoint.info` carries it.
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
    accountId: z.string().nullable().optional(),
    // What a person allowed in the CLIs' global settings. No paths, so a remote client learns none.
    agentIntegrations: AgentIntegrationsSummarySchema.optional(),
    // Null while worktrees go in the data folder. Only told to a client that presented the local secret.
    worktreeRoot: z.string().nullable().optional(),
    // Kept in `endpoint.json`; empty while nobody set one.
    nodeSizes: EndpointNodeSizesSchema.optional(),
    // Anonymous daily usage counts sent from a release build. Absent reads as on, from a machine that has the switch.
    usageStats: z.boolean().optional(),
    // Every request this machine answers, so a client checks a request newer than 0.18.0 before it sends one
    // instead of catching `unknown-request`. Only `endpoint.info` carries it; a machine without it is refused as older.
    features: z.array(z.string()).optional(),
    // True on a machine that resolves `references` on `chat.send`; without it a client sends only `chats`.
    viewReferences: z.boolean().optional()
});
export type EndpointInfo = z.infer<typeof EndpointInfoSchema>;

/*
 * `endpoint.info`. `client` names the app that asks, which a machine counts in its anonymous usage. A
 * string rather than a list, so a machine that does not know a newer kind counts nothing instead of refusing.
 */
export const EndpointInfoPayloadSchema = z.object({ client: z.string().max(32).optional() });
export type EndpointInfoPayload = z.infer<typeof EndpointInfoPayloadSchema>;

export const USAGE_CLIENT_KINDS = ['desktop', 'ios', 'station'] as const;
export type UsageClientKind = (typeof USAGE_CLIENT_KINDS)[number];

// `usage.startup`: how long the desktop app took from its start to its first connection, once per start.
export const UsageStartupPayloadSchema = z.object({ ms: z.number().int().min(1).max(USAGE_MAX_STARTUP_MS) });
export type UsageStartupPayload = z.infer<typeof UsageStartupPayloadSchema>;

// `usage.count` and `usage.timing`: what only the app on this machine sees, for its anonymous usage counts.
export const UsageCountPayloadSchema = z.object({ counter: z.enum(USAGE_CLIENT_COUNTERS) });
export type UsageCountPayload = z.infer<typeof UsageCountPayloadSchema>;
export const UsageTimingPayloadSchema = z.object({ timing: z.enum(USAGE_CLIENT_TIMINGS), ms: z.number().int().min(0).max(USAGE_MAX_STARTUP_MS) });
export type UsageTimingPayload = z.infer<typeof UsageTimingPayloadSchema>;

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
 * The switches a person sets on a machine, one schema for both requests that change them. Every field
 * left out leaves the machine as it stands. `endpoint.settings` takes these alone.
 */
export const EndpointSettingsSchema = z.object({
    ...MACHINE_SWITCHES,
    // Turning it on is refused with `closed-lid-no-rule` while the rule is not installed; off always goes through.
    keepAwakeLidClosed: z.boolean().optional(),
    broker: BrokerSettingSchema.optional(),
    lanDoor: z.boolean().optional(),
    // Only the owner of the machine may set it: the folder new worktrees are made in. An empty string puts it back.
    worktreeRoot: z.string().max(4096).optional(),
    // Only the owner of the machine may set it.
    usageStats: z.boolean().optional()
});
export type EndpointSettings = z.infer<typeof EndpointSettingsSchema>;

/*
 * `endpoint.setIdentity`. Name and icon are always sent, since null is a choice: the default name, or no
 * icon. The switches beside them are the ones of `endpoint.settings`.
 */
export const EndpointSetIdentityPayloadSchema = z.object({
    name: z.string().min(1).max(80).nullable(),
    icon: ProjectIconChoiceSchema.nullable(),
    ...EndpointSettingsSchema.shape
});
export type EndpointSetIdentityPayload = z.infer<typeof EndpointSetIdentityPayloadSchema>;

export const EndpointChangedEventSchema = z.object({
    id: z.string().min(1),
    label: z.string(),
    nameSource: EndpointNameSourceSchema,
    icon: ProjectIconChoiceSchema.nullable(),
    ...MACHINE_SWITCHES,
    keepAwakeLidClosed: z.boolean().optional(),
    keepAwakeLidRule: z.boolean().optional(),
    broker: BrokerSettingSchema.optional(),
    brokerUrl: z.string().nullish(),
    brokerFixed: z.boolean().optional(),
    lan: LanDoorSchema.nullish(),
    lanDoor: z.boolean().optional(),
    lanDoorFixed: z.boolean().optional(),
    agentIntegrations: AgentIntegrationsSummarySchema.optional(),
    nodeSizes: EndpointNodeSizesSchema.optional(),
    usageStats: z.boolean().optional()
});
export type EndpointChangedEvent = z.infer<typeof EndpointChangedEventSchema>;

const NodeSideSchema = (min: number) => z.number().int().min(min).max(NODE_SIZE_MAX);

/*
 * `endpoint.setNodeSize`: the size new nodes of a kind take on this machine, a person's node and an
 * agent's alike. Null puts the kind back to its built-in size. Whole pixels, no smaller than a frame
 * can be dragged.
 */
export const EndpointSetNodeSizePayloadSchema = z.object({
    kind: NodeKindSchema,
    size: z.object({ w: NodeSideSchema(NODE_SIZE_MIN.w), h: NodeSideSchema(NODE_SIZE_MIN.h) }).nullable()
});
export type EndpointSetNodeSizePayload = z.infer<typeof EndpointSetNodeSizePayloadSchema>;

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
    // Set when this session is another machine of the account that works here (a peer) rather than a client.
    machineId: z.string().min(1).optional(),
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
 * `endpoint.signPeerAccess`: this machine asking to work in `machineId`. Any client may ask, since it is a
 * person who links two machines and the answer gives a client nothing beyond what it can already do.
 * The page posts the answer, with `machineId` and `nonce`, to the address book with its own session.
 */
export const EndpointSignPeerAccessPayloadSchema = z.object({
    machineId: MachineIdSchema,
    nonce: NonceSchema
});
export type EndpointSignPeerAccessPayload = z.infer<typeof EndpointSignPeerAccessPayloadSchema>;

// Both signatures are over the same request: one by the peer key, one by this machine's own key.
export const EndpointSignPeerAccessResultSchema = z.object({
    peerMachineId: MachineIdSchema,
    peerPublicKey: PublicKeySchema,
    peerSignature: SignatureSchema,
    machineSignature: SignatureSchema
});
export type EndpointSignPeerAccessResult = z.infer<typeof EndpointSignPeerAccessResultSchema>;

/*
 * `endpoint.leaveAccount`, local secret only. Every client a statement let in loses its access until the
 * machine signs for an account again.
 */
export const EndpointLeaveAccountResultSchema = z.object({
    revoked: z.number().int().min(0)
});
export type EndpointLeaveAccountResult = z.infer<typeof EndpointLeaveAccountResultSchema>;
