import { createPublicKey, verify } from 'node:crypto';

/* Whether a signature over exactly this message was made with the private half of this raw ed25519 key in base64url. */
export const verifySignature = (publicKey: string, message: string, signature: string): boolean => {
    const raw = Buffer.from(publicKey, 'base64url');
    // Anything that is not 32 bytes is not a key and never reaches the verifier.
    if (raw.length !== 32) {
        return false;
    }
    try {
        const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
        return verify(null, Buffer.from(message, 'utf8'), key, Buffer.from(signature, 'base64url'));
    } catch {
        return false;
    }
};
