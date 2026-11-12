import { EmptySchema } from '@adecore/agent-contracts/protocol';
import {
    MachineIdSchema,
    LanDoorSchema,
    NonceSchema,
    PublicKeySchema,
    RegisterMachinePayloadSchema,
    SignatureSchema,
    USAGE_CLIENT_COUNTERS,
    USAGE_CLIENT_TIMINGS,
    USAGE_MAX_STARTUP_MS
} from '@ruimte/pulsar';
import { z } from 'zod';
import { AgentIntegrationsSummarySchema } from './agent-integrations.ts';
import { ENDPOINT_CHANGED_SETTINGS, ENDPOINT_INFO_SETTINGS, ENDPOINT_REQUEST_SETTINGS, START_FOLDER_MAX } from './machine-settings.ts';
import { MachineUpdateSchema } from './machine-update.ts';
import { NODE_SIZE_MAX, NODE_SIZE_MIN } from './node-defaults.ts';
import { NodeKindSchema, ProjectIconChoiceSchema } from './project.ts';
import { ProtocolVersionSchema } from './protocol.ts';

// How a client reaches a daemon; the loopback one is what the app starts with.
export const ReachabilitySchema = z.enum(['loopback', 'lan', 'tunnel', 'public']);
export type Reachability = z.infer<typeof ReachabilitySchema>;

// Whether a person named this machine from a client, or it still answers to the name it started with.
export const EndpointNameSourceSchema = z.enum(['chosen', 'default']);
export type EndpointNameSource = z.infer<typeof EndpointNameSourceSchema>;

export { CLOSED_LID_BATTERY_FLOOR, KeepAwakeModeSchema, type KeepAwakeMode } from './keep-awake.ts';

/*
 * What a person sets on a machine comes from `MACHINE_SETTINGS`, and an absent field reads as the row's
 * default. `endpoint.info` also tells the owner of the machine the settings only it sees.
 */
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
    ...ENDPOINT_INFO_SETTINGS,
    // Only macOS has a way to hold the block.
    keepAwakeAvailable: z.boolean().optional(),
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
    // True when a flag or the environment decides the broker, so `broker` is kept but changes nothing.
    brokerFixed: z.boolean().optional(),
    // A client on the same network signals there before it tries the broker. Null while the door is closed.
    lan: LanDoorSchema.nullish(),
    // True when a flag decides the door, so `lanDoor` is kept but changes nothing.
    lanDoorFixed: z.boolean().optional(),
    // Null when on none. Only told to a client that presented the local secret.
    accountId: z.string().nullable().optional(),
    // What a person allowed in the CLIs' global settings. No paths, so a remote client learns none.
    agentIntegrations: AgentIntegrationsSummarySchema.optional(),
    // Only told to a client that presented the local secret: this Windows machine has no Git for Windows, so agents cannot start and a terminal cannot open in Git Bash.
    gitBashMissing: z.boolean().optional(),
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
export const EndpointInfoPayloadSchema = z.object({
    client: z.string().max(32).optional(),
    /*
     * What the app tells of itself for the machine's list of connected clients, shown and never checked.
     * Strings rather than lists, so a machine shows a newer value instead of refusing it: `clientOs` is
     * `macos`, `windows`, `linux`, `ios` or `ipados`, and `clientDevice` is `desktop`, `phone` or `tablet`.
     */
    clientVersion: z.string().max(64).optional(),
    clientOs: z.string().max(64).optional(),
    clientOsVersion: z.string().max(64).optional(),
    clientDevice: z.string().max(64).optional(),
    /*
     * What the app reads beyond the wire it shipped with, the reverse of `features`. `tolerantWire`: it keeps a chat
     * item, union member, list element or state word it does not know in its place instead of refusing the answer.
     */
    clientFeatures: z.array(z.string().max(64)).max(32).optional()
});
export type EndpointInfoPayload = z.infer<typeof EndpointInfoPayloadSchema>;

export const TOLERANT_WIRE_FEATURE = 'tolerantWire';

export const USAGE_CLIENT_KINDS = ['desktop', 'ios', 'station'] as const;
export type UsageClientKind = (typeof USAGE_CLIENT_KINDS)[number];

// `usage.startup`: how long the desktop app took from its start to its first connection, once per start.
export const UsageStartupPayloadSchema = z.object({ ms: z.number().int().min(1).max(USAGE_MAX_STARTUP_MS) });

// `usage.count` and `usage.timing`: what only the app on this machine sees, for its anonymous usage counts.
export const UsageCountPayloadSchema = z.object({ counter: z.enum(USAGE_CLIENT_COUNTERS) });
export type UsageCountPayload = z.infer<typeof UsageCountPayloadSchema>;
export const UsageTimingPayloadSchema = z.object({ timing: z.enum(USAGE_CLIENT_TIMINGS), ms: z.number().int().min(0).max(USAGE_MAX_STARTUP_MS) });
export type UsageTimingPayload = z.infer<typeof UsageTimingPayloadSchema>;

/*
 * The switches a person sets on a machine, one schema for both requests that change them. Every field
 * left out leaves the machine as it stands. `endpoint.settings` takes these alone.
 */
export const EndpointSettingsSchema = z.object(ENDPOINT_REQUEST_SETTINGS);
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

export const EndpointChangedEventSchema = z.object({
    id: z.string().min(1),
    label: z.string(),
    nameSource: EndpointNameSourceSchema,
    icon: ProjectIconChoiceSchema.nullable(),
    ...ENDPOINT_CHANGED_SETTINGS,
    keepAwakeLidRule: z.boolean().optional(),
    brokerUrl: z.string().nullish(),
    brokerFixed: z.boolean().optional(),
    lan: LanDoorSchema.nullish(),
    lanDoorFixed: z.boolean().optional(),
    agentIntegrations: AgentIntegrationsSummarySchema.optional()
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

/*
 * `endpoint.setStartFolder`: the folder browsing starts in on this machine, for every client of it. A path
 * means something on one machine only, so it is the machine's. Empty puts it back to the home folder.
 */
export const EndpointSetStartFolderPayloadSchema = z.object({
    folder: z.string().max(START_FOLDER_MAX)
});

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

export const PairingOriginSchema = z.enum(['link', 'statement']);

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

/*
 * One client connected to a machine now, as it told of itself in `endpoint.info`. `access` is `local` (the
 * local secret), `account`, `machine` (a peer) or `mcp`, an external MCP client that made a request lately.
 * Strings, so an older client shows a newer kind rather than refusing the list.
 */
export const ConnectedClientSchema = z.object({
    id: z.string().min(1),
    access: z.string(),
    // The session's label, or the name a person reads for an external MCP client.
    label: z.string().optional(),
    machineId: z.string().optional(),
    client: z.string().optional(),
    version: z.string().optional(),
    os: z.string().optional(),
    osVersion: z.string().optional(),
    device: z.string().optional(),
    // Absent for an external MCP client, which holds no channel.
    reachability: ReachabilitySchema.optional(),
    connectedAt: z.number(),
    // Only for an external MCP client: its last request.
    lastRequestAt: z.number().optional(),
    // The channel of the asking client itself.
    current: z.boolean()
});
export type ConnectedClient = z.infer<typeof ConnectedClientSchema>;

export const ClientListResultSchema = z.object({ clients: z.array(ConnectedClientSchema) });
export type ClientListResult = z.infer<typeof ClientListResultSchema>;

export const AuthRevokePayloadSchema = z.object({
    id: z.string().min(1)
});

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
 * `endpoint.signRegistration`: the client posts the signed agreement with its own session; the daemon
 * holds no account token. Local secret only. Another account is refused with `machine-has-account`
 * until `endpoint.leaveAccount`.
 */
export const EndpointSignRegistrationPayloadSchema = z.object({
    accountId: z.string().min(1).max(64)
});

export const EndpointSignRegistrationResultSchema = z.object({
    registration: RegisterMachinePayloadSchema
});

/*
 * `endpoint.signPeerAccess`: this machine asking to work in `machineId`. Any client may ask, since it is a
 * person who links two machines and the answer gives a client nothing beyond what it can already do.
 * The page posts the answer, with `machineId` and `nonce`, to the address book with its own session.
 */
export const EndpointSignPeerAccessPayloadSchema = z.object({
    machineId: MachineIdSchema,
    nonce: NonceSchema
});

// Both signatures are over the same request: one by the peer key, one by this machine's own key.
export const EndpointSignPeerAccessResultSchema = z.object({
    peerMachineId: MachineIdSchema,
    peerPublicKey: PublicKeySchema,
    peerSignature: SignatureSchema,
    machineSignature: SignatureSchema
});

/*
 * `endpoint.leaveAccount`, local secret only. Every client a statement let in loses its access until the
 * machine signs for an account again.
 */
export const EndpointLeaveAccountResultSchema = z.object({
    revoked: z.number().int().min(0)
});

export const AUTH_REQUEST_SCHEMAS = {
    'usage.startup': { payload: UsageStartupPayloadSchema, result: EmptySchema },
    'usage.count': { payload: UsageCountPayloadSchema, result: EmptySchema },
    'usage.timing': { payload: UsageTimingPayloadSchema, result: EmptySchema },
    'endpoint.info': { payload: EndpointInfoPayloadSchema, result: EndpointInfoSchema },
    'endpoint.setIdentity': { payload: EndpointSetIdentityPayloadSchema, result: EndpointInfoSchema },
    'endpoint.settings': { payload: EndpointSettingsSchema, result: EndpointInfoSchema },
    'endpoint.setNodeSize': { payload: EndpointSetNodeSizePayloadSchema, result: EndpointInfoSchema },
    'endpoint.setStartFolder': { payload: EndpointSetStartFolderPayloadSchema, result: EndpointInfoSchema },
    'endpoint.closedLidRule': { payload: EndpointClosedLidRulePayloadSchema, result: EndpointInfoSchema },
    'endpoint.signPeerAccess': { payload: EndpointSignPeerAccessPayloadSchema, result: EndpointSignPeerAccessResultSchema },
    'endpoint.signRegistration': { payload: EndpointSignRegistrationPayloadSchema, result: EndpointSignRegistrationResultSchema },
    'endpoint.leaveAccount': { payload: EmptySchema, result: EndpointLeaveAccountResultSchema },
    'auth.sessions': { payload: EmptySchema, result: AuthSessionsResultSchema },
    'auth.revoke': { payload: AuthRevokePayloadSchema, result: EmptySchema },
    // Who is connected now; a person's own, so none of these is on a peer's list.
    'client.list': { payload: EmptySchema, result: ClientListResultSchema },
    'client.watch': { payload: EmptySchema, result: EmptySchema },
    'client.unwatch': { payload: EmptySchema, result: EmptySchema }
} as const;

export const AUTH_EVENT_SCHEMAS = {
    'endpoint.changed': EndpointChangedEventSchema,
    // A client connected, left or told of itself, or an external MCP client became active; only to the clients that asked with `client.watch`.
    'client.changed': EmptySchema,
    // To the desktop app on this machine only: a person asked another client to install the update.
    'endpoint.updateInstall': EmptySchema
} as const;
