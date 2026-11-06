import { clientChannelMessage, daemonChannelMessage, localChannelProof } from '@ruimte/pulsar';
import { z } from 'zod';
import {
    DIRECT_COMPRESSION,
    DirectAcceptedFrameSchema,
    DirectChallengeFrameSchema,
    DirectProofFrameSchema,
    DirectRefusedFrameSchema,
    type DirectAcceptedFrame,
    type DirectChallengeFrame,
    type DirectKeyProofFrame,
    type DirectProofFrame,
    type DirectRefusedFrame,
    type DirectSecretProofFrame
} from './direct.ts';
import { PROTOCOL_VERSION } from './protocol.ts';

/*
 * The handshake on a channel, with no socket and no keys of its own: the daemon that answers it, the
 * daemon that dials it for a peer and the page that dials it all build, read and prove the same frames
 * here, and bring their own signing, verifying and secret.
 */

/* The first frames a dialing end reads: the daemon's challenge, then its verdict. */
export const DirectHandshakeFrameSchema = z.discriminatedUnion('type', [DirectChallengeFrameSchema, DirectAcceptedFrameSchema, DirectRefusedFrameSchema]);
export type DirectHandshakeFrame = z.infer<typeof DirectHandshakeFrameSchema>;

export function parseHandshakeFrame(json: unknown): DirectHandshakeFrame | null {
    const parsed = DirectHandshakeFrameSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
}

export function parseProofFrame(json: unknown): DirectProofFrame | null {
    const parsed = DirectProofFrameSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
}

export function challengeFrame(issued: Pick<DirectChallengeFrame, 'challenge' | 'daemon'>): DirectChallengeFrame {
    return { type: 'direct.challenge', protocol: PROTOCOL_VERSION, challenge: issued.challenge, daemon: issued.daemon, compression: [DIRECT_COMPRESSION] };
}

export function acceptedFrame(ticket: { ticket: string; expiresIn: number } | null): DirectAcceptedFrame {
    return { type: 'direct.accepted', ticket: ticket?.ticket ?? null, expiresIn: ticket?.expiresIn ?? null };
}

export function refusedFrame(reason: string, extra: { protocol?: number; code?: string } = {}): DirectRefusedFrame {
    return {
        type: 'direct.refused',
        reason,
        ...(extra.protocol === undefined ? {} : { protocol: extra.protocol }),
        ...(extra.code === undefined ? {} : { code: extra.code })
    };
}

export type VerifySignature = (publicKey: string, message: string, signature: string) => boolean | Promise<boolean>;

/* The daemon a row pinned; a row that never learned the daemon's id pins its key alone. */
export interface PinnedDaemon {
    publicKey: string;
    daemonId: string | null;
}

/* Whether the daemon that sent this challenge is the pinned one and signed this channel's binding with its key. */
export async function daemonProvedItself(pinned: PinnedDaemon, frame: DirectChallengeFrame, binding: string, verify: VerifySignature): Promise<boolean> {
    const { daemon } = frame;
    if (daemon.publicKey !== pinned.publicKey || (pinned.daemonId !== null && pinned.daemonId !== daemon.id)) {
        return false;
    }
    return verify(pinned.publicKey, daemonChannelMessage(daemon.id, frame.challenge, binding), daemon.signature);
}

export interface ChannelSigner {
    publicKey: string;
    sign(message: string): string | Promise<string>;
}

export async function keyProofFrame(signer: ChannelSigner, daemonId: string, challenge: string, binding: string): Promise<DirectKeyProofFrame> {
    const signature = await signer.sign(clientChannelMessage(daemonId, challenge, signer.publicKey, binding));
    return { type: 'direct.key', protocol: PROTOCOL_VERSION, challenge, publicKey: signer.publicKey, signature };
}

export async function secretProofFrame(secret: string, daemonId: string, challenge: string, binding: string): Promise<DirectSecretProofFrame> {
    return { type: 'direct.secret', protocol: PROTOCOL_VERSION, challenge, proof: await localChannelProof(secret, daemonId, challenge, binding) };
}
