import { z } from 'zod';
import { SignalEnvelopeSchema } from '@ruimte/pulsar';
import { ProtocolVersionSchema } from './protocol.ts';

/*
 * A direct connection: the client's wire over a WebRTC DataChannel instead of a WebSocket. Until
 * there is a broker the signals ride over a socket the client already holds to the same daemon, as
 * `direct.signal` one way and `direct.signaled` the other, carrying the Pulsar envelope unchanged so
 * the broker can take over that leg without anything here changing shape.
 */
export const DirectSignalPayloadSchema = z.object({
    envelope: SignalEnvelopeSchema
});
export type DirectSignalPayload = z.infer<typeof DirectSignalPayloadSchema>;

// What the client names the one channel it opens; the daemon refuses any other.
export const DIRECT_CHANNEL_LABEL = 'ruimte';

/*
 * The first messages on a channel, before a single request is allowed. The channel inherits nothing
 * from the socket that signaled it: over the broker there is no such socket, so the proof has to
 * travel on the channel itself.
 */
export const DirectChallengeFrameSchema = z.object({
    type: z.literal('direct.challenge'),
    // The daemon's wire version, before the client proves anything. Absent from a daemon from before versions.
    protocol: ProtocolVersionSchema.optional(),
    challenge: z.string().min(1).max(256),
    daemon: z.object({
        id: z.string().min(1).max(256),
        publicKey: z.string().min(1).max(256),
        signature: z.string().min(1).max(512)
    })
});
export type DirectChallengeFrame = z.infer<typeof DirectChallengeFrameSchema>;

export const DirectKeyProofFrameSchema = z.object({
    type: z.literal('direct.key'),
    // The client's wire version; a client from before versions sends none.
    protocol: ProtocolVersionSchema.optional(),
    challenge: z.string().min(1).max(256),
    publicKey: z.string().min(1).max(256),
    signature: z.string().min(1).max(512)
});

// The app on the daemon's own machine holds the local secret instead of a paired key; it proves it without sending it.
export const DirectSecretProofFrameSchema = z.object({
    type: z.literal('direct.secret'),
    protocol: ProtocolVersionSchema.optional(),
    challenge: z.string().min(1).max(256),
    proof: z.string().min(1).max(256)
});

export const DirectProofFrameSchema = z.discriminatedUnion('type', [DirectKeyProofFrameSchema, DirectSecretProofFrameSchema]);
export type DirectProofFrame = z.infer<typeof DirectProofFrameSchema>;

export const DirectAcceptedFrameSchema = z.object({
    type: z.literal('direct.accepted'),
    // A ticket for the HTTP routes an `<img>` fetches, for a client that signed with a key; null for the local secret.
    ticket: z.string().min(1).nullable(),
    expiresIn: z.number().nullable()
});

export const DirectRefusedFrameSchema = z.object({
    type: z.literal('direct.refused'),
    reason: z.string().max(512),
    // Set when the refusal is about the wire version: the daemon's own, so the client can say which side is behind.
    protocol: ProtocolVersionSchema.optional()
});

export const DirectVerdictFrameSchema = z.discriminatedUnion('type', [DirectAcceptedFrameSchema, DirectRefusedFrameSchema]);
export type DirectVerdictFrame = z.infer<typeof DirectVerdictFrameSchema>;

/* Every DTLS fingerprint an SDP announces, normalized, so both peers read the same list out of the same text. */
export const sdpFingerprints = (sdp: string): string[] => {
    const found = new Set<string>();
    for (const match of sdp.matchAll(/^a=fingerprint:(\S+)\s+([0-9A-Fa-f:]+)\s*$/gm)) {
        found.add(`${match[1]!.toLowerCase()} ${match[2]!.toUpperCase()}`);
    }
    return [...found].sort();
};

/*
 * What ties the handshake to the one DTLS session it runs over: the fingerprints of the offer and of
 * the answer, as each peer applied them. Something in the signaling path that swaps a fingerprint for
 * its own ends up with two DTLS sessions whose peers compute two different bindings, so neither
 * signature below verifies on the other side.
 */
export const channelBinding = (offerSdp: string, answerSdp: string): string => JSON.stringify([sdpFingerprints(offerSdp), sdpFingerprints(answerSdp)]);

/*
 * The bytes signed on a channel. Prefixes of their own, so a signature over the HTTP handshake's
 * challenge never verifies as one over a channel's, and the binding last, since it is JSON and the
 * fields before it never hold a newline.
 */
export const daemonChannelMessage = (daemonId: string, challenge: string, binding: string): string =>
    `ruimte-daemon-channel-v1\n${daemonId}\n${challenge}\n${binding}`;

export const clientChannelMessage = (daemonId: string, challenge: string, publicKey: string, binding: string): string =>
    `ruimte-client-channel-v1\n${daemonId}\n${challenge}\n${publicKey}\n${binding}`;

// Keyed with the local secret as an HMAC-SHA256, so the channel learns that the client holds it and never the secret itself.
export const localSecretChannelMessage = (daemonId: string, challenge: string, binding: string): string =>
    `ruimte-local-channel-v1\n${daemonId}\n${challenge}\n${binding}`;

/*
 * A frame larger than the peer's SCTP max-message-size is refused outright (werift announces 64 KiB,
 * Chromium 256 KiB), and a screen at attach or a project document is easily more. So every frame goes
 * out in pieces: a first character that says whether more follow, then at most this many UTF-16 code
 * units, which is at most 48 KiB of UTF-8.
 */
export const DIRECT_PIECE_CHARS = 16_000;

const MORE = '+';
const LAST = '=';

export const splitFrame = (data: string, pieceChars: number = DIRECT_PIECE_CHARS): string[] => {
    if (data.length <= pieceChars) {
        return [LAST + data];
    }
    const pieces: string[] = [];
    let start = 0;
    while (start < data.length) {
        let end = Math.min(start + pieceChars, data.length);
        // Never between the halves of a surrogate pair: each piece is encoded on its own, and a lone half becomes U+FFFD.
        const code = data.charCodeAt(end - 1);
        if (end < data.length && code >= 0xd800 && code <= 0xdbff) {
            end -= 1;
        }
        pieces.push((end === data.length ? LAST : MORE) + data.slice(start, end));
        start = end;
    }
    return pieces;
};

export type AssembledPiece = { kind: 'frame'; frame: string } | { kind: 'partial' } | { kind: 'invalid' };

/* Joins the pieces of one frame again; a frame past `maxChars` or a piece without its mark is invalid. */
export class FrameAssembler {
    private parts: string[] = [];
    private length = 0;

    push(piece: string, maxChars: number): AssembledPiece {
        const mark = piece[0];
        if (mark !== MORE && mark !== LAST) {
            return { kind: 'invalid' };
        }
        const body = piece.slice(1);
        this.length += body.length;
        if (this.length > maxChars) {
            this.parts = [];
            this.length = 0;
            return { kind: 'invalid' };
        }
        this.parts.push(body);
        if (mark === MORE) {
            return { kind: 'partial' };
        }
        const frame = this.parts.length === 1 ? body : this.parts.join('');
        this.parts = [];
        this.length = 0;
        return { kind: 'frame', frame };
    }
}
