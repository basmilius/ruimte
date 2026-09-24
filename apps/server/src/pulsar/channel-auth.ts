import { createHmac } from 'node:crypto';
import {
    DirectProofFrameSchema,
    localSecretChannelMessage,
    PROTOCOL_VERSION,
    type AuthChallengeResult,
    type AuthTicketPayload,
    type AuthTicketResult
} from '@ruimte/contracts';
import type { TicketGrant, TicketUse } from '../auth/handshake.ts';
import { sameSecret } from '../auth/local-secret.ts';
import type { ClientAccess } from '../dispatcher.ts';
import { AUTHENTICATED_FRAME_CHARS, UNAUTHENTICATED_FRAME_CHARS, type DirectChannel } from './data-channel.ts';
import { errorText } from '../error-text.ts';

// Two round trips over a slow link fit easily; a peer that says nothing for this long is closed.
export const CHANNEL_AUTH_TIMEOUT_MS = 15_000;

// Long enough for the refusal to leave before the channel does, which a close straight after the send does not wait for.
const REFUSAL_LINGER_MS = 250;

export interface ChannelAuthOptions {
    channel: DirectChannel;
    // What `channelBinding` makes of the offer and the answer this channel was opened with.
    binding: string;
    handshake: {
        challenge(binding: string | null): AuthChallengeResult;
        redeem(payload: AuthTicketPayload, binding: string | null): Promise<AuthTicketResult | null>;
        spend(challenge: string, binding: string | null): boolean;
        ticketAccess(ticket: string, use: TicketUse): Promise<TicketGrant | null>;
    };
    daemonId: string;
    localSecret: string;
    reachability: ClientAccess['reachability'];
    timeoutMs?: number;
}

/* The proof a client on the daemon's own machine sends in place of a key signature. */
export const localSecretProof = (secret: string, daemonId: string, challenge: string, binding: string): string =>
    createHmac('sha256', secret)
        .update(localSecretChannelMessage(daemonId, challenge, binding))
        .digest('base64url');

/*
 * The HTTP handshake, run as the first frames of a channel. The daemon speaks first with a challenge
 * it signed over the channel's binding; the client answers with a key signature or the local secret's
 * proof over the same binding; the daemon answers with its verdict. Nothing the client sends before
 * that verdict reaches the dispatcher, and a channel that is refused is closed.
 *
 * Answers the access the channel gets, or null when it gets none.
 */
export const authenticateChannel = (options: ChannelAuthOptions): Promise<ClientAccess | null> =>
    new Promise((resolve) => {
        const { channel, binding, handshake } = options;
        const issued = handshake.challenge(binding);
        let settled = false;

        const settle = (access: ClientAccess | null): void => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            // A channel that ends without a proof takes its challenge along, so the pool never outgrows the open attempts.
            handshake.spend(issued.challenge, binding);
            resolve(access);
        };

        const refuse = (reason: string, protocol?: number): void => {
            if (settled) {
                return;
            }
            channel.receiveWith(() => undefined, UNAUTHENTICATED_FRAME_CHARS);
            channel.send(JSON.stringify({ type: 'direct.refused', reason, ...(protocol === undefined ? {} : { protocol }) }));
            settle(null);
            setTimeout(() => channel.close(4003, reason), REFUSAL_LINGER_MS);
        };

        const timer = setTimeout(() => refuse('The handshake took too long'), options.timeoutMs ?? CHANNEL_AUTH_TIMEOUT_MS);
        channel.onClose(() => settle(null));

        const verify = async (raw: string): Promise<void> => {
            let json: unknown;
            try {
                json = JSON.parse(raw);
            } catch {
                refuse('Expected a proof');
                return;
            }
            const parsed = DirectProofFrameSchema.safeParse(json);
            if (!parsed.success || parsed.data.challenge !== issued.challenge) {
                refuse('Expected a proof');
                return;
            }
            const proof = parsed.data;
            if (proof.protocol !== undefined && proof.protocol !== PROTOCOL_VERSION) {
                refuse('This machine and this client run different versions of Ruimte', PROTOCOL_VERSION);
                return;
            }
            if (proof.type === 'direct.key') {
                const ticket = await handshake.redeem({ publicKey: proof.publicKey, challenge: proof.challenge, signature: proof.signature }, binding);
                const sessionId = ticket === null ? null : ((await handshake.ticketAccess(ticket.ticket, 'bytes'))?.sessionId ?? null);
                if (ticket === null || sessionId === null) {
                    refuse('This machine does not recognize that signature. Pair again.');
                    return;
                }
                accept({ reachability: options.reachability, sessionId }, ticket);
                return;
            }
            const expected = localSecretProof(options.localSecret, options.daemonId, proof.challenge, binding);
            if (!handshake.spend(proof.challenge, binding) || !sameSecret(proof.proof, expected)) {
                refuse('That is not the secret of this machine');
                return;
            }
            accept({ reachability: options.reachability, sessionId: null }, null);
        };

        const accept = (access: ClientAccess, ticket: AuthTicketResult | null): void => {
            if (settled) {
                return;
            }
            channel.send(JSON.stringify({ type: 'direct.accepted', ticket: ticket?.ticket ?? null, expiresIn: ticket?.expiresIn ?? null }));
            channel.receiveWith(() => undefined, AUTHENTICATED_FRAME_CHARS);
            settle(access);
        };

        // One proof per channel: whatever follows it before the verdict is not read.
        channel.receiveWith((raw) => {
            channel.receiveWith(() => undefined, UNAUTHENTICATED_FRAME_CHARS);
            void verify(raw).catch((e) => {
                console.error('Checking a direct channel proof failed:', errorText(e));
                refuse('The machine could not check the proof');
            });
        }, UNAUTHENTICATED_FRAME_CHARS);
        channel.send(JSON.stringify({ type: 'direct.challenge', protocol: PROTOCOL_VERSION, challenge: issued.challenge, daemon: issued.daemon }));
    });
