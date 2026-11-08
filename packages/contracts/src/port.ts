import { z } from 'zod';

/*
 * A development port a person shared on purpose, so their other clients can open it through the machine
 * connection. A grant names one literal loopback address and one port and never a hostname.
 */
export const PORT_HOSTS = ['127.0.0.1', '::1'] as const;
export const PortHostSchema = z.enum(PORT_HOSTS);
export type PortHost = z.infer<typeof PortHostSchema>;

/* The bytes of one chunk in either direction, decoded. */
export const PORT_CHUNK_BYTES = 16 * 1024;

/* How many bytes of a stream may be on their way in one direction before the receiver says it consumed some. */
export const PORT_WINDOW_BYTES = 256 * 1024;

/* The least the machine connection may hold, with a port chunk added, before port data waits. */
export const PORT_BUFFER_BYTES = 64 * 1024;

/* Unconsumed and in-flight bytes of all streams of one client, per direction. */
export const PORT_CLIENT_BYTES = 1024 * 1024;

export const PORT_CLIENT_STREAMS = 16;
export const PORT_MACHINE_STREAMS = 64;

/* A control request or a write answers within this long, so the client's normal request timer stays enough. */
export const PORT_ANSWER_MS = 5000;

const PortNumberSchema = z.number().int().min(1).max(65535);

/* Chosen by the client, like a session id; long enough that a guess finds nobody else's. */
export const PortStreamIdSchema = z.string().min(8).max(64);

export const PortGrantSchema = z.object({
    id: z.string().min(1).max(64),
    projectId: z.string().min(1).max(256),
    host: PortHostSchema,
    port: PortNumberSchema,
    /* Whether a person or an agent (while the machine allows that) shared it. */
    sharedBy: z.enum(['person', 'agent']),
    createdAt: z.number().int().nonnegative()
});
export type PortGrant = z.infer<typeof PortGrantSchema>;

/* The grants are for the account's own clients, so any of them may read the list. */
export const PortListResultSchema = z.object({ grants: z.array(PortGrantSchema).max(256) });

export const PortSharePayloadSchema = z.object({
    projectId: PortGrantSchema.shape.projectId,
    port: PortNumberSchema,
    host: PortHostSchema.optional()
});

export const PortShareResultSchema = z.object({ grant: PortGrantSchema });

export const PortRevokePayloadSchema = z.object({ id: PortGrantSchema.shape.id });

export const PortOpenPayloadSchema = z.object({ streamId: PortStreamIdSchema, grantId: PortGrantSchema.shape.id });

export const PortOpenResultSchema = z.object({
    /* How many bytes the client may have unanswered in `port.write` at once. */
    window: z.number().int().positive()
});

/* `data` is base64 of at most `PORT_CHUNK_BYTES`; `offset` is where its first byte sits in the stream, so a gap or a replay fails the stream. */
export const PortWritePayloadSchema = z.object({
    streamId: PortStreamIdSchema,
    offset: z.number().int().nonnegative(),
    data: z
        .string()
        .min(1)
        .max(Math.ceil(PORT_CHUNK_BYTES / 3) * 4)
});

/* The bytes the machine wrote to the service so far, which frees window for the next write. */
export const PortWriteResultSchema = z.object({ flushed: z.number().int().nonnegative() });

/* The bytes of the stream the client consumed in all; an answer that repeats an older number adds no window. */
export const PortCreditPayloadSchema = z.object({ streamId: PortStreamIdSchema, offset: z.number().int().nonnegative() });

/* `half: 'write'` ends what the client sends and keeps the answer coming; without it the stream ends on both sides. */
export const PortClosePayloadSchema = z.object({ streamId: PortStreamIdSchema, half: z.literal('write').optional() });

export const PortDataEventSchema = z.object({
    streamId: PortStreamIdSchema,
    offset: z.number().int().nonnegative(),
    data: z
        .string()
        .min(1)
        .max(Math.ceil(PORT_CHUNK_BYTES / 3) * 4)
});

export const PORT_END_REASONS = ['eof', 'closed', 'error', 'revoked', 'overload'] as const;

/* The last word of a stream. `offset` is how many bytes it sent, so a client that has fewer knows it lost some. */
export const PortEndEventSchema = z.object({
    streamId: PortStreamIdSchema,
    offset: z.number().int().nonnegative(),
    reason: z.enum(PORT_END_REASONS),
    message: z.string().max(300).optional()
});
export type PortEndEvent = z.infer<typeof PortEndEventSchema>;
