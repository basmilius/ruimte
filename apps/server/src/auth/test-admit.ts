import type { AuthStore } from './auth-store.ts';

let nonces = 0;

/* For tests: lets a key in the way a checked statement does, and answers its session. */
export async function admitClient(store: AuthStore, publicKey: string, label = 'Laptop', accountId = 'owner'): Promise<string> {
    nonces += 1;
    const admitted = await store.admitStatement({
        publicKey,
        label,
        nonce: `test-nonce-${nonces}`.padEnd(22, 'n'),
        keepNonceUntil: Number.MAX_SAFE_INTEGER,
        accountId
    });
    if (!('sessionId' in admitted)) {
        throw new Error(`The store refused the key: ${admitted.refused}`);
    }
    return admitted.sessionId;
}
