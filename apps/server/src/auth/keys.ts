import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';

/*
 * The key pair of this machine. A public key travels as its raw 32 bytes in base64url, which is the
 * one shape both ends can produce without a library (WebCrypto exports `raw`, node exports the same
 * bytes as the `x` of an OKP JWK); checking a signature over it is `@ruimte/pulsar/verify-node`.
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
