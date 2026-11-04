import { z } from 'zod';
import { AccessStatementSchema, PeerStatementSchema } from './address-book.ts';

/*
 * What two peers say to each other to open a DataChannel. It rides inside a relayed broker message,
 * and over a connection that is already authenticated it travels on its own, so nothing in here
 * knows about the broker.
 *
 * ICE is gathered before the offer goes out, so a signal is usually one offer and one answer; the
 * candidate is there for a peer that trickles, and close is how either side gives up on an attempt.
 */

const SDP_MAX_LENGTH = 32_768;

/*
 * What an offer from a key the machine has never paired with carries to get in: a statement from the
 * address book that names this machine and the offer's own key, and what the machine should call the
 * client in its list of who has access. The machine checks the statement against the pinned key and
 * spends its nonce before it answers; a paired key leaves this off.
 */
export const SignalAccessSchema = z.object({
    statement: AccessStatementSchema,
    label: z.string().min(1).max(80)
});

/*
 * The same for a machine of the account that works in this one: a peer statement in place of a client
 * statement, never both. Strict, so an offer that carries the two is read as the client one it is.
 */
export const SignalPeerAccessSchema = z
    .object({
        peer: PeerStatementSchema,
        label: z.string().min(1).max(80)
    })
    .strict();

export type SignalAccess = z.infer<typeof SignalAccessSchema>;

// What an offer carries to get in: a client's statement, or a machine's as a peer.
export const SignalOfferAccessSchema = z.union([SignalPeerAccessSchema, SignalAccessSchema]);
export type SignalOfferAccess = z.infer<typeof SignalOfferAccessSchema>;

export const SignalOfferSchema = z.object({
    kind: z.literal('offer'),
    sdp: z.string().min(1).max(SDP_MAX_LENGTH),
    access: SignalOfferAccessSchema.optional()
});

export const SignalAnswerSchema = z.object({
    kind: z.literal('answer'),
    sdp: z.string().min(1).max(SDP_MAX_LENGTH)
});

// The fields of an `RTCIceCandidateInit`; an empty candidate is the end-of-candidates marker.
export const SignalCandidateSchema = z.object({
    kind: z.literal('candidate'),
    candidate: z.string().max(1024),
    sdpMid: z.string().max(64).nullable(),
    sdpMLineIndex: z.number().int().min(0).max(65_535).nullable()
});

/*
 * `not-paired` is a machine telling a key it has never paired with, or revoked, that it will not answer
 * it; an offer whose statement does not hold up gets the same. `statements-refused` is a machine that
 * was told to take no statements at all, said only to an offer whose statement was otherwise good.
 */
export const SignalCloseReasonSchema = z.enum(['declined', 'failed', 'timeout', 'done', 'not-paired', 'statements-refused']);

export const SignalCloseSchema = z.object({
    kind: z.literal('close'),
    reason: SignalCloseReasonSchema
});

export const SignalSchema = z.discriminatedUnion('kind', [SignalOfferSchema, SignalAnswerSchema, SignalCandidateSchema, SignalCloseSchema]);
export type Signal = z.infer<typeof SignalSchema>;

/*
 * One signal of one attempt. The offerer picks the connection id, so a retry never mixes its answer
 * or its candidates up with the attempt it replaces.
 */
export const SignalEnvelopeSchema = z.object({
    connectionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    signal: SignalSchema
});
export type SignalEnvelope = z.infer<typeof SignalEnvelopeSchema>;
