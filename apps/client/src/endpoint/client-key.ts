import i18next from 'i18next';

const DB_NAME = 'ruimte-auth';
const STORE_NAME = 'keys';
const RECORD_ID = 'client';

/* What this client signs a daemon's challenge with. The private half is never a value, only a handle. */
export interface ClientKey {
    /* The raw ed25519 public key in base64url, which is the shape the daemon stores and looks a client up by. */
    publicKey: string;
    sign(message: string): Promise<string>;
}

/* Where the key pair is kept between reloads; a test hands in its own instead of an IndexedDB. */
export interface KeyStore {
    read(): Promise<CryptoKeyPair | null>;
    write(pair: CryptoKeyPair): Promise<void>;
}

const base64url = (bytes: ArrayBuffer): string => {
    let binary = '';
    for (const byte of new Uint8Array(bytes)) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

/*
 * IndexedDB, because a `CryptoKey` survives a structured clone and `localStorage` only holds
 * strings. That is the whole reason to prefer it: the pair is generated non-extractable, so the
 * private half exists only as a handle the browser signs with and no script can ever read the
 * bytes, not this code and not anything injected into the page. A session token in `localStorage`
 * is readable by every script that runs on the origin; this is not.
 */
export const indexedDbKeyStore = (): KeyStore => {
    const open = (): Promise<IDBDatabase> =>
        new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error(i18next.t('machines:storage.indexedDbClosed')));
        });

    const run = <T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
        open().then(
            (db) =>
                new Promise<T>((resolve, reject) => {
                    const request = act(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error ?? new Error(i18next.t('machines:storage.indexedDbRefused')));
                })
        );

    return {
        read: () => run<CryptoKeyPair | undefined>('readonly', (store) => store.get(RECORD_ID)).then((value) => value ?? null),
        write: (pair) => run('readwrite', (store) => store.put(pair, RECORD_ID)).then(() => undefined)
    };
};

const toClientKey = async (pair: CryptoKeyPair): Promise<ClientKey> => ({
    publicKey: base64url(await crypto.subtle.exportKey('raw', pair.publicKey)),
    sign: async (message) => base64url(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(message)))
});

/*
 * One key pair for this client, not one per daemon: every daemon it pairs with is a machine of the
 * same person, and a key each would buy nothing but bookkeeping. Answers null where ed25519 or
 * IndexedDB is missing, and the caller falls back to the session token it already has.
 */
export const createClientKeyLoader = (store: KeyStore = indexedDbKeyStore()): (() => Promise<ClientKey | null>) => {
    let pending: Promise<ClientKey | null> | null = null;
    const load = async (): Promise<ClientKey | null> => {
        const stored = await store.read();
        if (stored) {
            return toClientKey(stored);
        }
        const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])) as CryptoKeyPair;
        await store.write(pair);
        return toClientKey(pair);
    };
    return () => {
        pending ??= load().catch((e) => {
            console.warn('This browser has no key pair to sign with; falling back to the session token', e);
            // Forgotten, so a browser that failed once (a private window, a first run without ed25519) can try again.
            pending = null;
            return null;
        });
        return pending;
    };
};

export const clientKey = createClientKeyLoader();
