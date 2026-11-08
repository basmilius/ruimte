import { z } from 'zod';
import { RuntimeModeSchema } from './model.ts';

/* How far an external MCP client reaches: read what is there, work on canvases and agents, or also run the machine's own features. */
export const EXTERNAL_TIERS = ['read', 'work', 'machine'] as const;
export const ExternalTierSchema = z.enum(EXTERNAL_TIERS);
export type ExternalTier = z.infer<typeof ExternalTierSchema>;

/* The tier a hosted client gets when a person names none. */
export const DEFAULT_EXTERNAL_TIER: ExternalTier = 'work';

/* The widest mode an agent a hosted client starts may run in, unless a person chose higher on the credential. */
export const DEFAULT_EXTERNAL_CEILING = 'supervised' as const;

/*
 * What a credential reaches, which only a person in the app sets: its projects (null for all of them), its tier,
 * the mode ceiling of the agents it starts and the approvals box.
 */
export const ExternalGrantSchema = z.object({
    tier: ExternalTierSchema,
    projects: z.array(z.string().min(1).max(256)).max(1000).nullable(),
    ceiling: RuntimeModeSchema,
    approvals: z.boolean()
});
export type ExternalGrant = z.infer<typeof ExternalGrantSchema>;

export const CredentialKindSchema = z.enum(['oauth', 'bearer']);
export type CredentialKind = z.infer<typeof CredentialKindSchema>;

/* A credential as the settings list it. The secret is never part of it: it is shown once, when a bearer is made. */
export const CredentialSchema = z.object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(120),
    kind: CredentialKindSchema,
    grant: ExternalGrantSchema,
    /* A bearer only: whether it may also come over the public hostname, which is the weaker form. */
    bearerOnHostname: z.boolean(),
    /* Milliseconds since the epoch; null for no end, which is the default. */
    expiresAt: z.number().int().nonnegative().nullable(),
    createdAt: z.number().int().nonnegative(),
    lastUsedAt: z.number().int().nonnegative().nullable()
});
export type Credential = z.infer<typeof CredentialSchema>;

export const CredentialListResultSchema = z.object({ credentials: z.array(CredentialSchema).max(1000) });

/* A bearer, made in the app. A grant left out is the hosted client's default: all projects, Work, `supervised`, no expiry. */
export const CredentialCreatePayloadSchema = z.object({
    label: CredentialSchema.shape.label,
    grant: ExternalGrantSchema.partial().optional(),
    bearerOnHostname: z.boolean().optional(),
    expiresAt: CredentialSchema.shape.expiresAt.optional()
});

export const CredentialCreateResultSchema = z.object({
    credential: CredentialSchema,
    /* Shown once. The daemon keeps a hash and cannot show it again. */
    secret: z.string().min(1)
});

export const CredentialUpdatePayloadSchema = z.object({
    id: CredentialSchema.shape.id,
    label: CredentialSchema.shape.label.optional(),
    grant: ExternalGrantSchema.partial().optional(),
    bearerOnHostname: z.boolean().optional(),
    expiresAt: CredentialSchema.shape.expiresAt.optional()
});

export const CredentialRevokePayloadSchema = z.object({ id: CredentialSchema.shape.id });

/* A client that asked to connect over OAuth and waits for a person on this machine. */
export const ConsentRequestSchema = z.object({
    id: z.string().min(1).max(64),
    clientName: z.string().min(1).max(200),
    /* The address of the client's metadata document, so a person can tell two clients of one name apart. */
    clientUrl: z.string().max(2048),
    /* The short code the client's page shows; the same code stands in this window. */
    code: z.string().min(1).max(16),
    requestedAt: z.number().int().nonnegative(),
    /* What the defaults would give: all projects, Work, `supervised`. */
    defaults: ExternalGrantSchema
});
export type ConsentRequest = z.infer<typeof ConsentRequestSchema>;

export const ConsentListResultSchema = z.object({ requests: z.array(ConsentRequestSchema).max(100) });

export const ConsentAnswerPayloadSchema = z.object({
    id: ConsentRequestSchema.shape.id,
    approve: z.boolean(),
    grant: ExternalGrantSchema.partial().optional(),
    expiresAt: CredentialSchema.shape.expiresAt.optional()
});

export const ConsentAnswerResultSchema = z.object({ credential: CredentialSchema.nullable() });

export const TUNNEL_STAGES = ['not-installed', 'installing', 'cannot-install', 'no-token', 'checking', 'no-tunnel', 'starting', 'running', 'failed'] as const;
export const TunnelStageSchema = z.enum(TUNNEL_STAGES);
export type TunnelStage = z.infer<typeof TunnelStageSchema>;

export const TunnelRowKindSchema = z.enum(['mcp', 'dev']);
export type TunnelRowKind = z.infer<typeof TunnelRowKindSchema>;

/* One hostname of the tunnel. A dev server has a port of its own on this machine; the MCP row always points at the external listener. */
export const TunnelRowSchema = z.object({
    id: z.string().min(1).max(64),
    kind: TunnelRowKindSchema,
    hostname: z.string().min(1).max(253),
    port: z.number().int().min(1).max(65535).nullable(),
    /* Whether the hostname is in the running configuration now. */
    enabled: z.boolean(),
    /* Whether it is on again after the daemon restarts. */
    comeBack: z.boolean()
});
export type TunnelRow = z.infer<typeof TunnelRowSchema>;

/* A Cloudflare account or zone the API token reaches, by the id Cloudflare gave it and the name a person knows it by. */
export const TunnelNamedSchema = z.object({ id: z.string().min(1).max(64), name: z.string().min(1).max(253) });
export type TunnelNamed = z.infer<typeof TunnelNamedSchema>;

/* The state every client may read; no tool and no client let in changes a tunnel. The API token is never in it. */
export const TunnelStateSchema = z.object({
    stage: TunnelStageSchema,
    /* What to install, or the sentence that says what went wrong; null otherwise. */
    message: z.string().max(2000).nullable(),
    /* Whether the machine holds an API token that Cloudflare accepted. */
    hasToken: z.boolean(),
    /* The accounts the token reaches, the one the tunnel lives on (or the only one), and the zones of that account. */
    accounts: z.array(TunnelNamedSchema).max(50),
    account: TunnelNamedSchema.nullable(),
    zones: z.array(TunnelNamedSchema).max(500),
    /* The name of this machine's tunnel in the Cloudflare dashboard; null until it is made. */
    tunnel: z.object({ name: z.string().max(253) }).nullable(),
    rows: z.array(TunnelRowSchema).max(100),
    /* Whether the external MCP listener is on, and where it listens on loopback. */
    mcp: z.object({ enabled: z.boolean(), port: z.number().int().min(0).max(65535).nullable() }),
    /* How many credentials were used lately, for the count the section shows. */
    clients: z.number().int().nonnegative(),
    /* A long random label for the MCP row, which the screen puts in front of the zone a person picks; null until there is a tunnel. */
    suggestedMcpLabel: z.string().max(63).nullable()
});
export type TunnelState = z.infer<typeof TunnelStateSchema>;

export const TunnelDiscoverResultSchema = z.object({
    ports: z.array(z.object({ port: z.number().int().min(1).max(65535), session: z.string().max(200).nullable() })).max(128)
});

/* The token a person typed. It travels once, on the local secret, and is never in a state. */
export const TunnelSetTokenPayloadSchema = z.object({ token: z.string().trim().min(10).max(500) });

export const TunnelSetupPayloadSchema = z.object({ account: TunnelNamedSchema.shape.id.optional() });

export const TunnelAddPayloadSchema = z.object({
    kind: TunnelRowKindSchema,
    /* The zone the hostname lives in, by the id the state listed. */
    zone: TunnelNamedSchema.shape.id,
    /* A label in front of the zone, or a full hostname inside it. */
    label: z.string().trim().min(1).max(253),
    port: z.number().int().min(1).max(65535).optional(),
    comeBack: z.boolean().optional()
});

export const TunnelUpdatePayloadSchema = z.object({
    id: TunnelRowSchema.shape.id,
    enabled: z.boolean().optional(),
    comeBack: z.boolean().optional()
});

export const TunnelRemovePayloadSchema = z.object({ id: TunnelRowSchema.shape.id });

export const TunnelSetMcpPayloadSchema = z.object({ enabled: z.boolean() });
