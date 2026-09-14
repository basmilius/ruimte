import type { Account, SessionExchangePayload, SessionResult } from './address-book.ts';
import { AddressBookRequestError, type AddressBookClient } from './address-book-client.ts';

/* What is kept between starts. The access token is not: it lives a quarter of an hour and a refresh makes a new one. */
export interface StoredSession {
    refreshToken: string;
    // When the session ends whatever happens, counted from sign-in.
    expiresAt: number;
    account: Account;
}

/* Where the refresh token lives: the shell's encrypted file, a phone's keychain, memory in a test. */
export interface SessionStore {
    read(): Promise<StoredSession | null>;
    write(session: StoredSession | null): Promise<void>;
}

/* A session as the side that uses it sees it: everything but the refresh token. */
export interface SessionView {
    accessToken: string;
    accessExpiresAt: number;
    expiresAt: number;
    account: Account;
}

export interface SessionVaultOptions {
    client: AddressBookClient;
    store: SessionStore;
    now?: () => number;
}

const viewOf = (result: SessionResult): SessionView => ({
    accessToken: result.accessToken,
    accessExpiresAt: result.accessExpiresAt,
    expiresAt: result.expiresAt,
    account: result.account
});

/*
 * The one holder of an address book refresh token. It trades a login code for a session, hands out
 * access tokens and never the refresh token, and rotates it on every refresh. Refreshes are one at a
 * time: the address book ends a session when a spent refresh token comes back, so two refreshes racing
 * with the same token would sign the person out.
 */
export class SessionVault {
    private readonly client: AddressBookClient;
    private readonly store: SessionStore;
    private readonly now: () => number;
    private current: SessionView | null = null;
    private refreshing: Promise<SessionView | null> | null = null;

    constructor(options: SessionVaultOptions) {
        this.client = options.client;
        this.store = options.store;
        this.now = options.now ?? Date.now;
    }

    async exchange(payload: SessionExchangePayload): Promise<SessionView> {
        const result = await this.client.exchange(payload);
        await this.keep(result);
        return this.current!;
    }

    /* Who is signed in, from what was kept, without asking the address book. */
    async restore(): Promise<{ account: Account; expiresAt: number } | null> {
        const stored = await this.store.read();
        if (!stored) {
            return null;
        }
        if (stored.expiresAt <= this.now()) {
            await this.store.write(null);
            return null;
        }
        return { account: stored.account, expiresAt: stored.expiresAt };
    }

    /*
     * A fresh access token. Null when there is no session any more (never signed in, ended, or the
     * address book refused the token), which clears what was kept; a network failure throws and keeps
     * the session, since the token is still good once the address book answers again.
     */
    refresh(): Promise<SessionView | null> {
        this.refreshing ??= this.rotate().finally(() => {
            this.refreshing = null;
        });
        return this.refreshing;
    }

    /* Ends the session at the address book when it can, and forgets it here whatever the answer. */
    async signOut(): Promise<void> {
        const token = this.current?.accessToken ?? (await this.refresh().catch(() => null))?.accessToken ?? null;
        this.current = null;
        await this.store.write(null);
        if (token !== null) {
            await this.client.endSession(token).catch(() => undefined);
        }
    }

    private async rotate(): Promise<SessionView | null> {
        const stored = await this.store.read();
        if (!stored || stored.expiresAt <= this.now()) {
            this.current = null;
            if (stored) {
                await this.store.write(null);
            }
            return null;
        }
        let result: SessionResult;
        try {
            result = await this.client.refresh(stored.refreshToken);
        } catch (e) {
            if (e instanceof AddressBookRequestError && (e.code === 'unauthorized' || e.code === 'bad-request')) {
                this.current = null;
                await this.store.write(null);
                return null;
            }
            throw e;
        }
        await this.keep(result);
        return this.current;
    }

    private async keep(result: SessionResult): Promise<void> {
        await this.store.write({ refreshToken: result.refreshToken, expiresAt: result.expiresAt, account: result.account });
        this.current = viewOf(result);
    }
}
