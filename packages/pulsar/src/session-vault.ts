import type { Account, SessionLoginCode, SessionResult } from './address-book.ts';
import { AddressBookRequestError, type AddressBookClient } from './address-book-client.ts';
import { sessionKeyMessage, sessionRefreshMessage } from './signing.ts';

/* What is kept between starts. The access token is not: it lives a quarter of an hour and a refresh makes a new one. */
export interface StoredSession {
    refreshToken: string;
    // When the session ends whatever happens, counted from sign-in.
    expiresAt: number;
    account: Account;
}

/* Where the refresh token lives: the shell's encrypted file, a page's IndexedDB, a phone's keychain, memory in a test. */
export interface SessionStore {
    read(): Promise<StoredSession | null>;
    write(session: StoredSession | null): Promise<void>;
}

/*
 * The key a session is bound to. The private half never leaves the side that holds it: a
 * non-extractable `CryptoKey` in a page, a key encrypted with the OS keychain in the desktop shell.
 */
export interface SessionSigner {
    /* The raw public key in base64url, the shape `PublicKeySchema` checks. */
    publicKey: string;
    sign(message: string): Promise<string>;
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
    /* Null when this side has no key any more, which leaves a kept session nothing to refresh with. */
    signer: () => Promise<SessionSigner | null>;
    now?: () => number;
}

const viewOf = (result: SessionResult): SessionView => ({
    accessToken: result.accessToken,
    accessExpiresAt: result.accessExpiresAt,
    expiresAt: result.expiresAt,
    account: result.account
});

/*
 * The one holder of an address book refresh token. It trades a login code for a session bound to its
 * signer's key, hands out access tokens and never the refresh token, and rotates it on every refresh.
 * Refreshes are one at a time: the address book ends a session when a spent refresh token comes back,
 * so two refreshes racing with the same token would sign the person out.
 */
export class SessionVault {
    private readonly client: AddressBookClient;
    private readonly store: SessionStore;
    private readonly signer: () => Promise<SessionSigner | null>;
    private readonly now: () => number;
    private current: SessionView | null = null;
    private refreshing: Promise<SessionView | null> | null = null;

    constructor(options: SessionVaultOptions) {
        this.client = options.client;
        this.store = options.store;
        this.signer = options.signer;
        this.now = options.now ?? Date.now;
    }

    async exchange(login: SessionLoginCode): Promise<SessionView> {
        const signer = await this.signer();
        if (!signer) {
            throw new Error('This device has no key to bind a session to');
        }
        const result = await this.client.exchange({
            ...login,
            sessionKey: signer.publicKey,
            sessionKeySignature: await signer.sign(sessionKeyMessage(login.code, signer.publicKey))
        });
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
     * A fresh access token. Null when there is no session any more (never signed in, ended, no key to
     * sign with, or the address book refused the token), which clears what was kept; a network failure
     * throws and keeps the session, since the token is still good once the address book answers again.
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
        const signer = stored && stored.expiresAt > this.now() ? await this.signer() : null;
        if (!stored || !signer) {
            this.current = null;
            if (stored) {
                await this.store.write(null);
            }
            return null;
        }
        const issuedAt = this.now();
        let result: SessionResult;
        try {
            result = await this.client.refresh({
                refreshToken: stored.refreshToken,
                issuedAt,
                signature: await signer.sign(sessionRefreshMessage(stored.refreshToken, issuedAt))
            });
        } catch (e) {
            if (e instanceof AddressBookRequestError && (e.code === 'unauthorized' || e.code === 'bad-request' || e.code === 'bad-signature')) {
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
