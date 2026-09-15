import { z } from 'zod';
import {
    APP_REDIRECT_LOOPBACK_PATH,
    AccountSchema,
    AddressBookClient,
    ADDRESS_BOOK_URL,
    SessionVault,
    isAppRedirectUri,
    type ProviderId,
    type SessionStore,
    type StoredSession
} from '@ruimte/pulsar';
import { clientKey } from '@/endpoint/client-key';
import { desktop } from '@/desktop/bridge';
import type { PulsarPlatform } from './desktop';
import { LoginError, codeFromCallback, createLoginState, createPkce, loginStartUrl } from './pkce';

/*
 * Signing in from a page without the desktop shell: the web client at `station.ruimte.app`, or the
 * client in Vite. The page leaves for the address book and comes back to `/pulsar/callback` on its own
 * origin, which is one of the redirects the address book allows.
 *
 * The refresh token sits in IndexedDB, where script on this origin can read it. What makes that
 * bearable is the key the session is bound to: the client's own ed25519 key, non-extractable, in the
 * same IndexedDB. A token read out of the page and carried elsewhere refreshes nothing, and the access
 * tokens live in memory only.
 */

const PENDING_LOGIN_KEY = 'ruimte.pulsar.pendingLogin';

// As long as the address book keeps a login open; a pending login older than that is one nobody finished.
export const PENDING_LOGIN_LIFETIME_MS = 10 * 60_000;

/* The part of a login that has to outlive the page: in localStorage, since a Home Screen app may come back in another browsing context. */
const PendingLoginSchema = z.object({
    verifier: z.string(),
    state: z.string(),
    redirectUri: z.string(),
    startedAt: z.number(),
    /* A login that adds a provider to the signed-in account, whose code goes to the account rather than the keeper. */
    link: z.boolean().optional()
});
export type PendingLogin = z.infer<typeof PendingLoginSchema>;

export interface LoginStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/* The redirect this page listens on, or null where the address book would refuse it. */
export const webRedirectUriFor = (origin: string): string | null => {
    const uri = `${origin}${APP_REDIRECT_LOOPBACK_PATH}`;
    return isAppRedirectUri(uri) ? uri : null;
};

/* Writes down what the return needs and answers the start URL to leave for. */
export const beginWebLogin = async (
    storage: LoginStorage,
    options: { addressBookUrl: string; redirectUri: string; provider?: ProviderId; link?: string; now?: number }
): Promise<string> => {
    const pkce = await createPkce();
    const state = createLoginState();
    const pending: PendingLogin = {
        verifier: pkce.verifier,
        state,
        redirectUri: options.redirectUri,
        startedAt: options.now ?? Date.now(),
        link: options.link !== undefined
    };
    storage.setItem(PENDING_LOGIN_KEY, JSON.stringify(pending));
    return loginStartUrl({
        addressBookUrl: options.addressBookUrl,
        provider: options.provider ?? 'github',
        redirectUri: options.redirectUri,
        state,
        challenge: pkce.challenge,
        link: options.link
    });
};

/*
 * The code and the verifier, when the query this page came back with belongs to the login it started.
 * The pending login is spent whatever the answer, so a reload of the callback address tries nothing twice.
 */
export const completeWebLogin = (
    storage: LoginStorage,
    query: URLSearchParams,
    now = Date.now()
): { code: string; verifier: string; redirectUri: string; link: boolean } => {
    const raw = storage.getItem(PENDING_LOGIN_KEY);
    storage.removeItem(PENDING_LOGIN_KEY);
    let pending: PendingLogin | null = null;
    try {
        const parsed = PendingLoginSchema.safeParse(raw === null ? null : JSON.parse(raw));
        pending = parsed.success ? parsed.data : null;
    } catch {
        pending = null;
    }
    if (!pending) {
        throw new LoginError('This page did not start a sign-in. Sign in again.');
    }
    if (now - pending.startedAt > PENDING_LOGIN_LIFETIME_MS) {
        throw new LoginError('The sign-in took too long. Sign in again.');
    }
    const code = codeFromCallback({ code: query.get('code'), state: query.get('state'), error: query.get('error') }, pending.state);
    return { code, verifier: pending.verifier, redirectUri: pending.redirectUri, link: pending.link === true };
};

const StoredSessionSchema = z.object({ refreshToken: z.string().min(1), expiresAt: z.number().int(), account: AccountSchema });

const DB_NAME = 'ruimte-pulsar';
const STORE_NAME = 'session';
const RECORD_ID = 'current';

/* The session in IndexedDB, beside the key it is bound to rather than in `localStorage` with everything else. */
export const indexedDbSessionStore = (): SessionStore => {
    const open = (): Promise<IDBDatabase> =>
        new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('IndexedDB would not open'));
        });

    const run = <T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
        open().then(
            (db) =>
                new Promise<T>((resolve, reject) => {
                    const request = act(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error ?? new Error('IndexedDB refused the request'));
                })
        );

    return {
        read: async () => {
            const parsed = StoredSessionSchema.safeParse(await run<unknown>('readonly', (store) => store.get(RECORD_ID)));
            return parsed.success ? (parsed.data as StoredSession) : null;
        },
        write: async (session) => {
            if (session === null) {
                await run('readwrite', (store) => store.delete(RECORD_ID));
                return;
            }
            await run('readwrite', (store) => store.put(session, RECORD_ID));
        }
    };
};

/* The page as a platform to sign in on, or null inside the desktop shell and on an origin the address book would not send a login back to. */
export const webPulsar = (): PulsarPlatform | null => {
    if (desktop() !== null || typeof location === 'undefined' || typeof indexedDB === 'undefined') {
        return null;
    }
    const redirectUri = webRedirectUriFor(location.origin);
    if (redirectUri === null) {
        return null;
    }
    const vault = new SessionVault({ client: new AddressBookClient(), store: indexedDbSessionStore(), signer: () => clientKey() });
    return {
        addressBook: async () => ADDRESS_BOOK_URL,
        keeper: vault,
        web: { redirectUri, storage: localStorage }
    };
};
