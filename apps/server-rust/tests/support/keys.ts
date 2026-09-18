import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';

/*
 * Ed25519 on both ends of the wire: WebCrypto in the browser, node's crypto here. A public key
 * travels as its raw 32 bytes in base64url, which is the one shape both sides can produce without
 * a library (WebCrypto exports `raw`, node exports the same bytes as the `x` of an OKP JWK).
 */
export interface KeyPair {
    publicKey: string;
    // PKCS#8 PEM, which is what goes on disk; nothing outside this module reads it.
    privateKey: string;
}

export const generateKeyPair = (): KeyPair => {
    const pair = generateKeyPairSync('ed25519');
    const jwk = pair.publicKey.export({ format: 'jwk' }) as { x?: string };
    return {
        publicKey: jwk.x ?? '',
        privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    };
};

export const signMessage = (privateKey: string, message: string): string =>
    sign(null, Buffer.from(message, 'utf8'), createPrivateKey(privateKey)).toString('base64url');

const publicKeyObject = (publicKey: string): KeyObject | null => {
    // Raw ed25519 is exactly 32 bytes; anything else is not a key and must not reach the verifier.
    const raw = Buffer.from(publicKey, 'base64url');
    if (raw.length !== 32) {
        return null;
    }
    try {
        return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
    } catch {
        return null;
    }
};

/* Whether a signature over exactly this message was made with the private half of this public key. */
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
