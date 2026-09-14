import { AccountSchema, SessionResultSchema, type SessionExchangePayload } from '@ruimte/pulsar';
import { z } from 'zod';

/* A session as this page holds it: the access token and who it is for, never the refresh token. */
export const SessionViewSchema = SessionResultSchema.omit({ refreshToken: true });
export type SessionView = z.infer<typeof SessionViewSchema>;

export const RestoredSessionSchema = z.object({ account: AccountSchema, expiresAt: z.number() });
export type RestoredSession = z.infer<typeof RestoredSessionSchema>;

/*
 * Whatever holds the refresh token for this client: the desktop shell today, a phone's keychain later.
 * The page asks it for access tokens and never sees what it keeps.
 */
export interface SessionKeeper {
    exchange(payload: SessionExchangePayload): Promise<SessionView>;
    /* A fresh access token, or null when there is no session any more. */
    refresh(): Promise<SessionView | null>;
    restore(): Promise<RestoredSession | null>;
    signOut(): Promise<void>;
}

// A token this close to its end is refreshed first, so a request never leaves with one that dies on the way.
export const ACCESS_TOKEN_MARGIN_MS = 60_000;

export interface AccessTokensOptions {
    now?: () => number;
    /* The keeper had no session left to refresh. */
    onSignedOut?(): void;
}

/* The access token this page is using, refreshed through the keeper when it is about to run out, one refresh at a time. */
export class AccessTokens {
    private readonly keeper: SessionKeeper;
    private readonly now: () => number;
    private readonly onSignedOut: () => void;
    private view: SessionView | null = null;
    private pending: Promise<string | null> | null = null;

    constructor(keeper: SessionKeeper, options: AccessTokensOptions = {}) {
        this.keeper = keeper;
        this.now = options.now ?? Date.now;
        this.onSignedOut = options.onSignedOut ?? (() => undefined);
    }

    set(view: SessionView | null): void {
        this.view = view;
    }

    token(): Promise<string | null> {
        if (this.view && this.view.accessExpiresAt - ACCESS_TOKEN_MARGIN_MS > this.now()) {
            return Promise.resolve(this.view.accessToken);
        }
        return this.refreshNow();
    }

    /* A new token whatever the one in hand says, for an answer that called it stale. */
    refreshNow(): Promise<string | null> {
        this.pending ??= this.keeper
            .refresh()
            .then((view) => {
                this.view = view;
                if (view === null) {
                    this.onSignedOut();
                }
                return view?.accessToken ?? null;
            })
            .finally(() => {
                this.pending = null;
            });
        return this.pending;
    }
}
