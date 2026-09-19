import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { PublicKeySchema } from './keys.ts';

/*
 * Checking an ed25519 signature where `node:crypto` is (the daemon, the broker). Its twin for a
 * browser, a phone and a Worker is `verify-web.ts`, reached through its own entry point: one file
 * with both would drag `node:crypto` into a Worker bundle, and the runtimes really do differ, down
 * to whether the answer is a boolean or a promise.
 */

const publicKeyObject = (publicKey: string): KeyObject | null => {
    if (!PublicKeySchema.safeParse(publicKey).success) {
        return null;
    }
    try {
        // Through the bytes and back, so what node is handed is the key's own spelling of itself.
        const raw = Buffer.from(publicKey, 'base64url');
        return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
    } catch {
        return null;
    }
};

/* Whether a signature over exactly this message was made with the private half of this raw ed25519 key in base64url. */
export const verifySignature = (publicKey: string, message: string, signature: string): boolean => {
    const key = publicKeyObject(publicKey);
    if (!key) {
        return false;
    }
    try {
        return verify(null, Buffer.from(message, 'utf8'), key, Buffer.from(signature, 'base64url'));
    } catch {
        return false;
    }
};

/* Whether a string is shaped like a public key at all, so a record is never written with rubbish in it. */
export const isPublicKey = (value: string): boolean => publicKeyObject(value) !== null;
