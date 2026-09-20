import { describe, expect, test } from 'bun:test';
import { createClientKeyLoader, type KeyStore } from './client-key';

/* Does what IndexedDB would for the page, minus the IndexedDB, by holding the pair in memory. */
const memoryStore = (): KeyStore & { writes: number } => {
    let held: CryptoKeyPair | null = null;
    return {
        writes: 0,
        read: async () => held,
        async write(pair) {
            held = pair;
            this.writes += 1;
        }
    };
};

const verify = async (publicKey: string, message: string, signature: string): Promise<boolean> => {
    const bytes = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (character) => character.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', bytes(publicKey), { name: 'Ed25519' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'Ed25519' }, key, bytes(signature), new TextEncoder().encode(message));
};

describe('the client key pair', () => {
    test('signs what a daemon can check against the public half it registered', async () => {
        const key = (await createClientKeyLoader(memoryStore())())!;
        expect(key.publicKey).toMatch(/^[\w-]{43}$/);

        const signature = await key.sign('ruimte-client-v1\ndaemon\nnonce');
        expect(await verify(key.publicKey, 'ruimte-client-v1\ndaemon\nnonce', signature)).toBe(true);
        expect(await verify(key.publicKey, 'ruimte-client-v1\ndaemon\nanother nonce', signature)).toBe(false);
    });

    test('generates once and answers with the same key after a reload', async () => {
        const store = memoryStore();
        const first = (await createClientKeyLoader(store)())!;
        // A second loader is what a reload builds, since the store is all that carries over.
        const second = (await createClientKeyLoader(store)())!;
        expect(second.publicKey).toBe(first.publicKey);
        expect(store.writes).toBe(1);
    });

    test('two clients are two keys, so one daemon can tell them apart', async () => {
        const first = (await createClientKeyLoader(memoryStore())())!;
        const second = (await createClientKeyLoader(memoryStore())())!;
        expect(second.publicKey).not.toBe(first.publicKey);
    });

    test('a store that refuses leaves the client without a key instead of without an app', async () => {
        const broken: KeyStore = {
            read: () => Promise.reject(new Error('no storage here')),
            write: () => Promise.resolve()
        };
        expect(await createClientKeyLoader(broken)()).toBeNull();
    });
});
