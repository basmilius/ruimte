import { AddressBookRequestError, type AddressBookClient } from './address-book-client.ts';
import type { Account, SessionLoginCode, SessionResult } from './address-book.ts';
import { sessionKeyMessage, sessionRefreshMessage } from './signing.ts';

/* What is kept between starts. The access token is not: it lives a quarter of an hour and a refresh makes a new one. */
export interface StoredSession {
    refreshToken: string;
    // When the session ends unless a refresh moves it on.
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

    /*
     * A key for this run only, standing in for one the keychain would not hand over. It refreshes only
     * a session it opened itself: one kept from before is bound to the key that could not be read.
     */
    temporary?: boolean;
    sign(message: string): Promise<string>;
}

/* Why a kept session was cleared: past its end, no key to sign with, or the code the address book refused it with. */
export type SessionForgetReason = 'expired' | 'no-key' | 'unauthorized' | 'bad-request' | 'bad-signature';

/* A kept session that the key for this run cannot refresh; the session stays for a start that can read its key. */
export class SessionKeyUnavailableError extends Error {
    constructor() {
        super('The key of this session cannot be read now');
        this.name = 'SessionKeyUnavailableError';
    }
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
    /*
     * Runs a refresh alone among every vault over the same store, such as a page's other tabs. A vault
     * only serializes its own refreshes, and two holders spending one token end the session everywhere.
     */
    exclusive?: <T>(run: () => Promise<T>) => Promise<T>;
    now?: () => number;
    onForget?: (reason: SessionForgetReason) => void;
}

interface Rotation {
    // The epoch the rotation began in, which says whether its result may still be kept.
    epoch: number;
    view: SessionView | null;
}

function viewOf(result: SessionResult): SessionView {
    return {
        accessToken: result.accessToken,
        accessExpiresAt: result.accessExpiresAt,
        expiresAt: result.expiresAt,
        account: result.account
    };
}

function refusal(e: unknown): SessionForgetReason | null {
    if (!(e instanceof AddressBookRequestError)) {
        return null;
    }

    return e.code === 'unauthorized' || e.code === 'bad-request' || e.code === 'bad-signature' ? e.code : null;
}

/*
 * The one holder of an address book refresh token. It trades a login code for a session bound to its
 * signer's key, hands out access tokens and never the refresh token, and rotates it on every refresh.
 * Refreshes are one at a time: the address book ends a session when a spent refresh token comes back,
 * so two refreshes racing with the same token would sign the person out.
 *
 * A sign-out wins from whatever was under way when it began: a refresh or a sign-in that answers
 * afterwards is never kept, so a session the person ended does not come back in the store.
 */
export class SessionVault {
    private readonly client: AddressBookClient;
    private readonly store: SessionStore;
    private readonly signer: () => Promise<SessionSigner | null>;
    private readonly exclusive: <T>(run: () => Promise<T>) => Promise<T>;
    private readonly now: () => number;
    private readonly onForget: (reason: SessionForgetReason) => void;
    private current: SessionView | null = null;
    // The public key of the session this vault opened, which a temporary key may go on refreshing.
    private openedWith: string | null = null;
    private refreshing: Promise<Rotation> | null = null;
    // Moves on with every sign-out and every session a sign-in kept; a rotation keeps its result only within the epoch it began in.
    private epoch = 0;
    // Moves on with every sign-out alone; a sign-in under way when it moved is not kept.
    private signOuts = 0;
    // Every read and write of the store, in the order they were asked, so a write never overtakes the one asked before it.
    private storeTail: Promise<unknown> = Promise.resolve();

    constructor(options: SessionVaultOptions) {
        this.client = options.client;
        this.store = options.store;
        this.signer = options.signer;
        this.exclusive = options.exclusive ?? ((run) => run());
        this.now = options.now ?? Date.now;
        this.onForget = options.onForget ?? (() => undefined);
    }

    async exchange(login: SessionLoginCode): Promise<SessionView> {
        const signOuts = this.signOuts;
        const signer = await this.signer();
        if (!signer) {
            throw new Error('This device has no key to bind a session to');
        }
        const result = await this.client.exchange({
            ...login,
            sessionKey: signer.publicKey,
            sessionKeySignature: await signer.sign(sessionKeyMessage(login.code, signer.publicKey))
        });
        if (signOuts !== this.signOuts) {
            await this.client.endSession(result.accessToken).catch(() => undefined);
            throw new Error('Signed out while signing in');
        }
        this.epoch += 1;
        this.openedWith = signer.publicKey;
        const view = viewOf(result);
        await this.keep(view, result);
        return view;
    }

    /* Who is signed in, from what was kept, without asking the address book. */
    async restore(): Promise<{ account: Account; expiresAt: number } | null> {
        return this.queue(async () => {
            const stored = await this.store.read();
            if (!stored) {
                return null;
            }
            if (stored.expiresAt <= this.now()) {
                await this.store.write(null);
                this.onForget('expired');

                return null;
            }
            return { account: stored.account, expiresAt: stored.expiresAt };
        });
    }

    /*
     * A fresh access token. Null when there is no session any more (never signed in, ended, no key to
     * sign with, or the address book refused the token), which clears what was kept. A network failure,
     * a clock the address book calls off or a key the keychain would not hand over this run throws and
     * keeps the session, since the token is still good once that is right again.
     */
    async refresh(): Promise<SessionView | null> {
        this.refreshing ??= this.exclusive(() => this.rotate()).finally(() => {
            this.refreshing = null;
        });
        const rotation = await this.refreshing;
        // A rotation overtaken by a sign-out or a new sign-in answers with what holds now.
        return rotation.epoch === this.epoch ? rotation.view : this.current;
    }

    /* Ends the session at the address book when it can, and forgets it here whatever the answer. */
    async signOut(): Promise<void> {
        this.epoch += 1;
        this.signOuts += 1;
        const known = this.current?.accessToken ?? null;
        const underway = this.refreshing;
        this.current = null;
        // Asked before anything after this call can read the store, so no later refresh finds the token.
        const stored = this.queue(() => this.store.read());
        this.queue(() => this.store.write(null)).catch(() => undefined);
        // Another holder's refresh under way writes what it rotated to; clearing in turn after it removes that too.
        await this.exclusive(() => this.queue(() => this.store.write(null)));

        // A refresh under way spent the kept token, so only its access token can still end the session.
        let token = known ?? (await underway?.catch(() => null))?.view?.accessToken ?? null;
        if (token === null) {
            token = await this.spend(await stored.catch(() => null)).catch(() => null);
        }
        if (token !== null) {
            await this.client.endSession(token).catch(() => undefined);
        }
    }

    private async rotate(): Promise<Rotation> {
        const epoch = this.epoch;
        const stored = await this.queue(() => this.store.read());
        if (!stored) {
            await this.forget(epoch, null);
            return { epoch, view: null };
        }
        if (stored.expiresAt <= this.now()) {
            await this.forget(epoch, 'expired');
            return { epoch, view: null };
        }
        const signer = await this.signer();
        if (!signer) {
            await this.forget(epoch, 'no-key');
            return { epoch, view: null };
        }
        if (signer.temporary && signer.publicKey !== this.openedWith) {
            throw new SessionKeyUnavailableError();
        }
        let result: SessionResult;
        try {
            result = await this.client.refresh(await this.refreshRequest(stored.refreshToken, signer));
        } catch (e) {
            const reason = refusal(e);
            if (reason) {
                await this.forget(epoch, reason);
                return { epoch, view: null };
            }
            throw e;
        }
        const view = viewOf(result);
        if (epoch === this.epoch) {
            await this.keep(view, result);
        }
        return { epoch, view };
    }

    /* Trades a kept refresh token for an access token without keeping what it rotated to. */
    private async spend(stored: StoredSession | null): Promise<string | null> {
        const signer = stored && stored.expiresAt > this.now() ? await this.signer() : null;
        if (!stored || !signer || (signer.temporary && signer.publicKey !== this.openedWith)) {
            return null;
        }
        return (await this.client.refresh(await this.refreshRequest(stored.refreshToken, signer))).accessToken;
    }

    private async refreshRequest(refreshToken: string, signer: SessionSigner): Promise<{ refreshToken: string; issuedAt: number; signature: string }> {
        const issuedAt = this.now();
        return { refreshToken, issuedAt, signature: await signer.sign(sessionRefreshMessage(refreshToken, issuedAt)) };
    }

    /*
     * Clears the session, unless a sign-out or a sign-in since the epoch already decided what is kept.
     * A reason means a session was kept and goes now; null means there was none to clear.
     */
    private async forget(epoch: number, reason: SessionForgetReason | null): Promise<void> {
        if (epoch !== this.epoch) {
            return;
        }
        this.current = null;
        if (reason) {
            await this.queue(() => this.store.write(null));
            this.onForget(reason);
        }
    }

    private keep(view: SessionView, result: SessionResult): Promise<void> {
        this.current = view;
        return this.queue(() => this.store.write({ refreshToken: result.refreshToken, expiresAt: result.expiresAt, account: result.account }));
    }

    private queue<T>(task: () => Promise<T>): Promise<T> {
        const run = this.storeTail.then(task);
        this.storeTail = run.catch(() => undefined);
        return run;
    }
}
