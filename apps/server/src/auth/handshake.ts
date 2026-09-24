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
import { verifySignature } from '@ruimte/pulsar/verify-node';

// Long enough for two round trips over a slow link, short enough that a challenge is not worth catching.
export const CHALLENGE_TTL_MS = 60 * 1000;

/*
 * How long a ticket stays good, counted from its last use or from the close of the socket it opened.
 * A page holds one for as long as it is open, because the bytes of an image or an attachment are
 * fetched over plain HTTP hours after the socket opened and a browser cannot sign those requests.
 */
export const TICKET_TTL_MS = 12 * 60 * 60 * 1000;

/*
 * A client keeps a handful: every reconnect signs for a fresh one, and a second tab of the same
 * browser is a second connection of the same client. The oldest go, so a long-lived page cannot
 * pile up tickets on the daemon.
 */
const TICKETS_PER_SESSION = 8;

// How many nonces asked for over HTTP can be waiting to be signed at once, over every client together.
const MAX_OPEN_CHALLENGES = 512;

// `open` while the socket a ticket opened is, which keeps the ticket alive however long the page fetches nothing.
type TicketSocket = 'unused' | 'open' | 'closed';

interface Ticket {
    // Null for a ticket the local secret was traded for.
    sessionId: string | null;
    expiresAt: number;
    socket: TicketSocket;
}

// What a ticket lets in: the paired session behind it, or null for the app on this machine.
export interface TicketGrant {
    sessionId: string | null;
}

// A socket takes a ticket once; bytes take it for as long as it lives.
export type TicketUse = 'socket' | 'bytes';

interface ChannelChallenge {
    challenge: string;
    expiresAt: number;
}

interface SigningIdentity {
    id: string;
    publicKey: string;
    sign(message: string): string;
}

/*
 * Both peers sign a fresh nonce, proving their pinned keys before the daemon issues a short-lived
 * connection ticket. Challenges and tickets stay in memory and are renewed after a restart.
 */
export class Handshake {
    private readonly store: AuthStore;
    private readonly identity: SigningIdentity;
    private readonly now: () => number;
    // Asked for over HTTP, by anyone.
    private readonly challenges = new Map<string, number>();
    /* One per direct channel, under its binding, so the pool is as large as the attempts `DirectPeers`
       lets open and a flood of HTTP challenges never pushes one out. */
    private readonly channelChallenges = new Map<string, ChannelChallenge>();
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
        const challenge = randomBytes(32).toString('base64url');
        const expiresAt = this.now() + CHALLENGE_TTL_MS;
        if (binding === null) {
            /* Nobody has to be paired to ask for one, so the list is capped as well as swept, or a caller
               that never signs decides how much memory this daemon holds. The slowest caller loses its
               nonce and asks again on its next try. */
            for (const stale of [...this.challenges.keys()].slice(0, Math.max(0, this.challenges.size - (MAX_OPEN_CHALLENGES - 1)))) {
                this.challenges.delete(stale);
            }
            this.challenges.set(challenge, expiresAt);
        } else {
            this.channelChallenges.set(binding, { challenge, expiresAt });
        }
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
        if (!(await this.store.noteSignedIn(sessionId))) {
            return null;
        }
        return { ticket: this.issueTicket(sessionId), expiresIn: TICKET_TTL_MS };
    }

    /* A ticket for the app on this machine, which the caller already saw present the local secret. */
    issueLocalTicket(): AuthTicketResult {
        this.sweep();
        return { ticket: this.issueTicket(null), expiresIn: TICKET_TTL_MS };
    }

    /*
     * Takes a challenge out, answering whether it was still good for this binding. Taken out whatever
     * the answer, so one nonce buys at most one attempt and never a replay; the local secret's proof
     * on a channel spends it here too, since it has no key to check.
     */
    spend(challenge: string, binding: string | null): boolean {
        if (binding === null) {
            const expiresAt = this.challenges.get(challenge);
            this.challenges.delete(challenge);
            return expiresAt !== undefined && this.now() <= expiresAt;
        }
        const entry = this.channelChallenges.get(binding);
        this.channelChallenges.delete(binding);
        return entry !== undefined && entry.challenge === challenge && this.now() <= entry.expiresAt;
    }

    /*
     * What a ticket lets in, with its life extended, or null when it is unknown, stale, already opened
     * a socket and is asked to open another, or belongs to a session revoked since it was handed out.
     */
    async ticketAccess(ticket: string, use: TicketUse): Promise<TicketGrant | null> {
        const entry = this.tickets.get(ticket);
        if (!entry) {
            return null;
        }
        if (this.expired(entry)) {
            this.tickets.delete(ticket);
            return null;
        }
        if (use === 'socket') {
            if (entry.socket !== 'unused') {
                return null;
            }
            // Before the await below, so two upgrades racing on one ticket cannot both get through.
            entry.socket = 'open';
        }
        entry.expiresAt = this.now() + TICKET_TTL_MS;
        if (entry.sessionId !== null && !(await this.store.hasSession(entry.sessionId))) {
            this.tickets.delete(ticket);
            return null;
        }
        return { sessionId: entry.sessionId };
    }

    /* The socket a ticket opened closed; from here the ticket lives on its use by bytes alone. */
    socketClosed(ticket: string): void {
        const entry = this.tickets.get(ticket);
        if (entry?.socket === 'open') {
            entry.socket = 'closed';
            entry.expiresAt = this.now() + TICKET_TTL_MS;
        }
    }

    /* Takes every ticket of a client away; revoking has to bite now, not at the next connection. */
    revoke(sessionId: string): void {
        for (const [ticket, entry] of this.tickets) {
            if (entry.sessionId === sessionId) {
                this.tickets.delete(ticket);
            }
        }
    }

    private issueTicket(sessionId: string | null): string {
        // A ticket behind an open socket is not a spare one; dropping it would break the page that socket serves.
        const spare = [...this.tickets].filter(([, entry]) => entry.sessionId === sessionId && entry.socket !== 'open');
        for (const [ticket] of spare.slice(0, Math.max(0, spare.length - (TICKETS_PER_SESSION - 1)))) {
            this.tickets.delete(ticket);
        }
        const ticket = randomBytes(32).toString('base64url');
        this.tickets.set(ticket, { sessionId, expiresAt: this.now() + TICKET_TTL_MS, socket: 'unused' });
        return ticket;
    }

    private expired(entry: Ticket): boolean {
        return entry.socket !== 'open' && this.now() > entry.expiresAt;
    }

    private sweep(): void {
        const now = this.now();
        for (const [challenge, expiresAt] of this.challenges) {
            if (now > expiresAt) {
                this.challenges.delete(challenge);
            }
        }
        for (const [binding, { expiresAt }] of this.channelChallenges) {
            if (now > expiresAt) {
                this.channelChallenges.delete(binding);
            }
        }
        for (const [ticket, entry] of this.tickets) {
            if (this.expired(entry)) {
                this.tickets.delete(ticket);
            }
        }
    }
}
