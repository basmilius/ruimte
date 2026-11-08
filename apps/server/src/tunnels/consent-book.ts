import { createHash } from 'node:crypto';
import type { ConsentRequest, ExternalGrant } from '@ruimte/contracts';
import { defaultGrant, mergedGrant } from './credential-store.ts';

/* How long a client waits for a person on this machine before the request is nothing. */
export const CONSENT_TIMEOUT_MS = 5 * 60_000;
/* How long an authorization code lives once approved. */
export const AUTHORIZATION_CODE_MS = 60_000;
const MAX_PENDING = 20;

// No 0 or O, 1 or I: the code is read off one screen and compared with another.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

export interface PendingConsent {
    id: string;
    code: string;
    clientId: string;
    clientName: string;
    redirectUri: string;
    state: string | null;
    challenge: string;
    createdAt: number;
    decision: { approved: true; grant: ExternalGrant; expiresAt: number | null; authorizationCode: string; approvedAt: number } | { approved: false } | null;
}

export type ConsentPoll =
    | { status: 'pending' }
    | { status: 'gone' }
    | { status: 'denied'; pending: PendingConsent }
    | { status: 'approved'; pending: PendingConsent; authorizationCode: string };

export interface ConsentBookOptions {
    now(): number;
    random(bytes: number): string;
    /* A number below `limit`, evenly spread. */
    pick(limit: number): number;
    changed(): void;
}

/* S256: the challenge a code verifier has to match. */
export function challengeOf(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
}

/*
 * The clients that wait for a person to approve them. It is memory only: a restart drops every request, and a client simply
 * asks again. A person sees the same short code here that the client's page shows, so they know which request they approve.
 */
export class ConsentBook {
    private readonly options: ConsentBookOptions;
    private pending = new Map<string, PendingConsent>();

    constructor(options: ConsentBookOptions) {
        this.options = options;
    }

    private sweep(): void {
        const now = this.options.now();

        for (const [id, entry] of this.pending) {
            const live =
                entry.decision === null
                    ? now - entry.createdAt < CONSENT_TIMEOUT_MS
                    : entry.decision.approved
                      ? now - entry.decision.approvedAt < AUTHORIZATION_CODE_MS
                      : now - entry.createdAt < CONSENT_TIMEOUT_MS;

            if (!live) {
                this.pending.delete(id);
            }
        }
    }

    private code(): string {
        return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[this.options.pick(CODE_ALPHABET.length)]).join('');
    }

    /* Null when too many requests wait already, which keeps a flood from filling the window. */
    request(input: Pick<PendingConsent, 'clientId' | 'clientName' | 'redirectUri' | 'state' | 'challenge'>): PendingConsent | null {
        this.sweep();

        if (this.pending.size >= MAX_PENDING) {
            return null;
        }

        const entry: PendingConsent = { id: this.options.random(16), code: this.code(), createdAt: this.options.now(), decision: null, ...input };

        this.pending.set(entry.id, entry);
        this.options.changed();

        return entry;
    }

    list(): ConsentRequest[] {
        this.sweep();

        return [...this.pending.values()]
            .filter((entry) => entry.decision === null)
            .map((entry) => ({
                id: entry.id,
                clientName: entry.clientName,
                clientUrl: entry.clientId,
                code: entry.code,
                requestedAt: entry.createdAt,
                defaults: defaultGrant()
            }));
    }

    /* A person's answer. False when the request is gone or answered already. */
    answer(id: string, approve: boolean, grant: Partial<ExternalGrant> | undefined, expiresAt: number | null | undefined): boolean {
        this.sweep();

        const entry = this.pending.get(id);

        if (entry === undefined || entry.decision !== null) {
            return false;
        }

        entry.decision = approve
            ? {
                  approved: true,
                  grant: mergedGrant(defaultGrant(), grant),
                  expiresAt: expiresAt ?? null,
                  authorizationCode: this.options.random(32),
                  approvedAt: this.options.now()
              }
            : { approved: false };
        this.options.changed();

        return true;
    }

    /* What the waiting page asks: still pending, or the outcome. */
    poll(id: string): ConsentPoll {
        this.sweep();

        const entry = this.pending.get(id);

        if (entry === undefined) {
            return { status: 'gone' };
        }

        if (entry.decision === null) {
            return { status: 'pending' };
        }

        return entry.decision.approved
            ? { status: 'approved', pending: entry, authorizationCode: entry.decision.authorizationCode }
            : { status: 'denied', pending: entry };
    }

    /* Settles an authorization code once, for the client that asked: the same client, redirect and PKCE verifier. */
    exchange(code: string, input: { clientId: string; redirectUri: string; verifier: string }): PendingConsent | null {
        this.sweep();

        for (const [id, entry] of this.pending) {
            if (entry.decision?.approved !== true || entry.decision.authorizationCode !== code) {
                continue;
            }

            // Spent whether or not the rest matches, so a guessed verifier gets one try.
            this.pending.delete(id);

            return entry.clientId === input.clientId && entry.redirectUri === input.redirectUri && challengeOf(input.verifier) === entry.challenge
                ? entry
                : null;
        }

        return null;
    }
}
