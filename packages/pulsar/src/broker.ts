import { z } from 'zod';
import { NonceSchema, PublicKeySchema, SignatureSchema } from './keys.ts';
import { SignalEnvelopeSchema } from './signaling.ts';

/*
 * The wire between a peer and the broker: one WebSocket with JSON frames. A peer announces a key,
 * signs the broker's nonce over `brokerHelloMessage`, and from then on may relay to other keys.
 * The broker holds nothing but which key sits on which socket, so a frame never names an account.
 */

// A machine keeps its socket open to be found; a client opens one only for as long as it signals.
export const BrokerRoleSchema = z.enum(['machine', 'client']);
export type BrokerRole = z.infer<typeof BrokerRoleSchema>;

// Every frame that carries a question gets an id of the peer's choosing, so a refusal can say which one it was about.
const FrameIdSchema = z.string().min(1).max(64);

export const BrokerHelloSchema = z.object({
    type: z.literal('hello'),
    role: BrokerRoleSchema,
    publicKey: PublicKeySchema
});
export type BrokerHello = z.infer<typeof BrokerHelloSchema>;

export const BrokerProveSchema = z.object({
    type: z.literal('prove'),
    signature: SignatureSchema
});
export type BrokerProve = z.infer<typeof BrokerProveSchema>;

/*
 * A signal for another key. The signature is the sender's, over `signalMessage`, and travels to the
 * receiver untouched; the broker could check it but the receiver must, since it is the one being
 * lied to if the broker is.
 */
export const BrokerRelaySchema = z.object({
    type: z.literal('relay'),
    id: FrameIdSchema,
    to: PublicKeySchema,
    envelope: SignalEnvelopeSchema,
    signature: SignatureSchema
});
export type BrokerRelay = z.infer<typeof BrokerRelaySchema>;

export const BrokerPeerFrameSchema = z.discriminatedUnion('type', [BrokerHelloSchema, BrokerProveSchema, BrokerRelaySchema]);
export type BrokerPeerFrame = z.infer<typeof BrokerPeerFrameSchema>;

// `broker` is the host the peer signs into its answer; the peer compares it with the host it dialed.
export const BrokerChallengeSchema = z.object({
    type: z.literal('challenge'),
    broker: z.string().min(1).max(253),
    nonce: NonceSchema
});
export type BrokerChallenge = z.infer<typeof BrokerChallengeSchema>;

export const BrokerReadySchema = z.object({
    type: z.literal('ready')
});
export type BrokerReady = z.infer<typeof BrokerReadySchema>;

// The broker wrote the relay to the receiver's socket; not that the receiver read it.
export const BrokerDeliveredSchema = z.object({
    type: z.literal('delivered'),
    id: FrameIdSchema
});
export type BrokerDelivered = z.infer<typeof BrokerDeliveredSchema>;

// A relay as the receiver gets it, with the sender's key filled in by the broker from the socket it arrived on.
export const BrokerRelayedSchema = z.object({
    type: z.literal('relayed'),
    from: PublicKeySchema,
    envelope: SignalEnvelopeSchema,
    signature: SignatureSchema
});
export type BrokerRelayed = z.infer<typeof BrokerRelayedSchema>;

export const BrokerErrorCodeSchema = z.enum([
    // The frame did not parse, or came before the step it needs (a relay before `ready`).
    'bad-frame',
    // The signature over the challenge did not verify; the socket closes after this.
    'bad-signature',
    // Nobody with that key is connected.
    'not-connected',
    // Another socket proved the same key later; this one closes after this.
    'replaced',
    'internal'
]);
export type BrokerErrorCode = z.infer<typeof BrokerErrorCodeSchema>;

export const BrokerErrorSchema = z.object({
    type: z.literal('error'),
    code: BrokerErrorCodeSchema,
    message: z.string().max(512),
    id: FrameIdSchema.optional()
});
export type BrokerError = z.infer<typeof BrokerErrorSchema>;

// Apart from the errors because a peer is expected to wait and try again rather than give up.
export const BrokerRateLimitedSchema = z.object({
    type: z.literal('rate-limited'),
    scope: z.enum(['ip', 'key']),
    retryAfterMs: z.number().int().min(0),
    id: FrameIdSchema.optional()
});
export type BrokerRateLimited = z.infer<typeof BrokerRateLimitedSchema>;

export const BrokerServerFrameSchema = z.discriminatedUnion('type', [
    BrokerChallengeSchema,
    BrokerReadySchema,
    BrokerDeliveredSchema,
    BrokerRelayedSchema,
    BrokerErrorSchema,
    BrokerRateLimitedSchema
]);
export type BrokerServerFrame = z.infer<typeof BrokerServerFrameSchema>;
