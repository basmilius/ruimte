import { randomBytes } from 'node:crypto';
import {
    clientAuthMessage,
    clientChannelMessage,
    daemonChallengeMessage,
    daemonChannelMessage,
    type AuthChallengeResult,
    type AuthTicketPayload,
    type AuthTicketResult
} from '@ruimte/contracts';
import type { AuthStore } from './auth-store.ts';
import { verifySignature } from './keys.ts';

// Long enough for two round trips over a slow link, short enough that a challenge is not worth catching.
export const CHALLENGE_TTL_MS = 60 * 1000;

/*
 * How long a ticket stays good, counted from its last use. A page holds one for as long as it is
 * open, because the bytes of an image or an attachment are fetched over plain HTTP hours after the
 * socket opened and a browser cannot sign those requests.
 */
export const TICKET_TTL_MS = 12 * 60 * 60 * 1000;

/*
 * A client keeps a handful: every reconnect signs for a fresh one, and a second tab of the same
 * browser is a second connection of the same client. The oldest go, so a long-lived page cannot
 * pile up tickets on the daemon.
 */
const TICKETS_PER_SESSION = 8;

// How many nonces can be waiting to be signed at once, over every client together.
const MAX_OPEN_CHALLENGES = 512;

interface Ticket {
    sessionId: string;
    expiresAt: number;
}

interface Challenge {
    expiresAt: number;
    // The DTLS session a challenge handed out on a direct channel belongs to; null for one asked for over HTTP.
    binding: string | null;
}

interface SigningIdentity {
    id: string;
    publicKey: string;
    sign(message: string): string;
}

/*
 * The proof that gets a connection in. The daemon hands out a nonce and signs it, so a client knows
 * it is talking to the machine it paired with and not to whatever answers on that address; the
 * client signs the same nonce back, so the daemon knows the client holds the private half of the
 * key it registered. What comes out is a ticket: a short-lived credential that rotates on every
 * connection, which is what rides in the socket URL instead of something long lived.
 *
 * Challenges and tickets live in memory only. A daemon that restarts hands out new ones, and a
 * client that finds its ticket refused simply signs again.
 */
export class Handshake {
    private readonly store: AuthStore;
    private readonly identity: SigningIdentity;
    private readonly now: () => number;
    private readonly challenges = new Map<string, Challenge>();
    private readonly tickets = new Map<string, Ticket>();

    constructor(store: AuthStore, identity: SigningIdentity, now: () => number = Date.now) {
        this.store = store;
        this.identity = identity;
        this.now = now;
    }

    /*
     * A nonce to sign, and the daemon's own signature over it, which is what pins the daemon. On a
     * direct channel the binding of that channel's DTLS session goes into both signatures, so a
     * challenge handed out on one channel can be answered on that channel alone.
     */
    challenge(binding: string | null = null): AuthChallengeResult {
        this.sweep();
        /* Nobody has to be paired to ask for one, so the list is capped as well as swept: without it
           a caller that never signs anything decides how much memory this daemon holds. Dropping the
           oldest costs a re-ask to whoever was slowest, and the client asks again on its next try. */
        for (const challenge of [...this.challenges.keys()].slice(0, Math.max(0, this.challenges.size - (MAX_OPEN_CHALLENGES - 1)))) {
            this.challenges.delete(challenge);
        }
        const challenge = randomBytes(32).toString('base64url');
        this.challenges.set(challenge, { expiresAt: this.now() + CHALLENGE_TTL_MS, binding });
        const message = binding === null ? daemonChallengeMessage(this.identity.id, challenge) : daemonChannelMessage(this.identity.id, challenge, binding);
        return {
            challenge,
            daemon: {
                id: this.identity.id,
                publicKey: this.identity.publicKey,
                signature: this.identity.sign(message)
            }
        };
    }

    /* Checks a signed challenge and answers with a ticket; null when anything about it does not hold up. */
    async redeem(payload: AuthTicketPayload, binding: string | null = null): Promise<AuthTicketResult | null> {
        if (!this.spend(payload.challenge, binding)) {
            return null;
        }
        const sessionId = await this.store.sessionForPublicKey(payload.publicKey);
        if (!sessionId) {
            return null;
        }
        const message =
            binding === null
                ? clientAuthMessage(this.identity.id, payload.challenge, payload.publicKey)
                : clientChannelMessage(this.identity.id, payload.challenge, payload.publicKey, binding);
        if (!verifySignature(payload.publicKey, message, payload.signature)) {
            return null;
        }
        await this.store.noteSignedIn(sessionId);
        return { ticket: this.issueTicket(sessionId), expiresIn: TICKET_TTL_MS };
    }

    /*
     * Takes a challenge out, answering whether it was still good for this binding. Taken out whatever
     * the answer, so one nonce buys at most one attempt and never a replay; the local secret's proof
     * on a channel spends it here too, since it has no key to check.
     */
    spend(challenge: string, binding: string | null): boolean {
        const entry = this.challenges.get(challenge);
        this.challenges.delete(challenge);
        return entry !== undefined && this.now() <= entry.expiresAt && entry.binding === binding;
    }

    /* The session behind a ticket, with its life extended, or null when it is unknown or stale. */
    ticketSession(ticket: string): string | null {
        const entry = this.tickets.get(ticket);
        if (!entry) {
            return null;
        }
        if (this.now() > entry.expiresAt) {
            this.tickets.delete(ticket);
            return null;
        }
        entry.expiresAt = this.now() + TICKET_TTL_MS;
        return entry.sessionId;
    }

    /* Takes every ticket of a client away; revoking has to bite now, not at the next connection. */
    revoke(sessionId: string): void {
        for (const [ticket, entry] of this.tickets) {
            if (entry.sessionId === sessionId) {
                this.tickets.delete(ticket);
            }
        }
    }

    private issueTicket(sessionId: string): string {
        const mine = [...this.tickets].filter(([, entry]) => entry.sessionId === sessionId);
        for (const [ticket] of mine.slice(0, Math.max(0, mine.length - (TICKETS_PER_SESSION - 1)))) {
            this.tickets.delete(ticket);
        }
        const ticket = randomBytes(32).toString('base64url');
        this.tickets.set(ticket, { sessionId, expiresAt: this.now() + TICKET_TTL_MS });
        return ticket;
    }

    private sweep(): void {
        const now = this.now();
        for (const [challenge, { expiresAt }] of this.challenges) {
            if (now > expiresAt) {
                this.challenges.delete(challenge);
            }
        }
        for (const [ticket, entry] of this.tickets) {
            if (now > entry.expiresAt) {
                this.tickets.delete(ticket);
            }
        }
    }
}
