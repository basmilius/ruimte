import { z } from 'zod';

/*
 * What two peers say to each other to open a DataChannel. It rides inside a relayed broker message,
 * and over a connection that is already authenticated it travels on its own, so nothing in here
 * knows about the broker.
 *
 * ICE is gathered before the offer goes out, so a signal is usually one offer and one answer; the
 * candidate is there for a peer that trickles, and close is how either side gives up on an attempt.
 */

export const SDP_MAX_LENGTH = 32_768;

export const SignalOfferSchema = z.object({
    kind: z.literal('offer'),
    sdp: z.string().min(1).max(SDP_MAX_LENGTH)
});
export type SignalOffer = z.infer<typeof SignalOfferSchema>;

export const SignalAnswerSchema = z.object({
    kind: z.literal('answer'),
    sdp: z.string().min(1).max(SDP_MAX_LENGTH)
});
export type SignalAnswer = z.infer<typeof SignalAnswerSchema>;

// The fields of an `RTCIceCandidateInit`; an empty candidate is the end-of-candidates marker.
export const SignalCandidateSchema = z.object({
    kind: z.literal('candidate'),
    candidate: z.string().max(1024),
    sdpMid: z.string().max(64).nullable(),
    sdpMLineIndex: z.number().int().min(0).max(65_535).nullable()
});
export type SignalCandidate = z.infer<typeof SignalCandidateSchema>;

// `not-paired` is a machine telling a key it has never paired with, or revoked, that it will not answer it.
export const SignalCloseReasonSchema = z.enum(['declined', 'failed', 'timeout', 'done', 'not-paired']);
export type SignalCloseReason = z.infer<typeof SignalCloseReasonSchema>;

export const SignalCloseSchema = z.object({
    kind: z.literal('close'),
    reason: SignalCloseReasonSchema
});
export type SignalClose = z.infer<typeof SignalCloseSchema>;

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
