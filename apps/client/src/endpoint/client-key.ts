import { toBase64Url } from '@ruimte/pulsar';
import { objectStoreRunner } from './indexed-db';

const DB_NAME = 'ruimte-auth';
const STORE_NAME = 'keys';
const RECORD_ID = 'client';

/* What this client signs a daemon's challenge with. The private half is never a value, only a handle. */
export interface ClientKey {
    /* The raw ed25519 public key in base64url, which is the shape the daemon stores and looks a client up by. */
    publicKey: string;
    sign(message: string): Promise<string>;
}

export interface KeyStore {
    read(): Promise<CryptoKeyPair | null>;
    write(pair: CryptoKeyPair): Promise<void>;
}

/*
 * IndexedDB, because a `CryptoKey` survives a structured clone and `localStorage` only holds
 * strings. The pair is non-extractable, so no script can ever read the private half.
 */
export function indexedDbKeyStore(): KeyStore {
    const run = objectStoreRunner(DB_NAME, STORE_NAME);
    return {
        read: () => run<CryptoKeyPair | undefined>('readonly', (store) => store.get(RECORD_ID)).then((value) => value ?? null),
        write: (pair) => run('readwrite', (store) => store.put(pair, RECORD_ID)).then(() => undefined)
    };
}

async function toClientKey(pair: CryptoKeyPair): Promise<ClientKey> {
    return {
        publicKey: toBase64Url(await crypto.subtle.exportKey('raw', pair.publicKey)),
        sign: async (message) => toBase64Url(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(message)))
    };
}

/*
 * One key pair for this client, not one per daemon: every daemon is a machine of the same person.
 * Answers null where ed25519 or IndexedDB is missing, and the caller falls back to its session token.
 */
export function createClientKeyLoader(store: KeyStore = indexedDbKeyStore()): () => Promise<ClientKey | null> {
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
}

export const clientKey = createClientKeyLoader();
