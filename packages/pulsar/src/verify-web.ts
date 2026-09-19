import { fromBase64Url } from './base64url.ts';
import { PublicKeySchema } from './keys.ts';

/*
 * Checking an ed25519 signature with WebCrypto, where there is no `node:crypto`: a browser, a phone
 * and a Worker. The twin for the daemon and the broker is `verify-node.ts`. Verifying needs no
 * private key, which is why neither side reaches for a library: what a runtime without Ed25519
 * loses is the pinning, not the connection.
 */
export const verifySignature = async (publicKey: string, message: string, signature: string): Promise<boolean> => {
    if (!PublicKeySchema.safeParse(publicKey).success) {
        return false;
    }
    try {
        const key = await crypto.subtle.importKey('raw', fromBase64Url(publicKey), { name: 'Ed25519' }, false, ['verify']);
        return await crypto.subtle.verify({ name: 'Ed25519' }, key, fromBase64Url(signature), new TextEncoder().encode(message));
    } catch {
        return false;
    }
};
