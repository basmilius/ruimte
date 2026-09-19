import { fromBase64Url } from '@ruimte/pulsar';

const encoder = new TextEncoder();

export interface StatementKey {
    privateKey: CryptoKey;
    // Raw base64url, what `/health` reports so a deploy can be checked against the pinned key.
    publicKey: string;
}

let cached: { secret: string; key: Promise<StatementKey> } | null = null;

const importStatementKey = async (secret: string): Promise<StatementKey> => {
    const privateKey = await crypto.subtle.importKey('pkcs8', fromBase64Url(secret), { name: 'Ed25519' }, true, ['sign']);
    const jwk = (await crypto.subtle.exportKey('jwk', privateKey)) as JsonWebKey;
    if (!jwk.x) {
        throw new Error('The statement key has no public half');
    }
    return { privateKey, publicKey: jwk.x };
};

// Imported once per isolate; a rotated secret arrives with a new isolate, and the comparison catches it anyway.
export const statementKeyOf = (secret: string): Promise<StatementKey> => {
    if (cached?.secret !== secret) {
        cached = { secret, key: importStatementKey(secret) };
    }
    return cached.key;
};

export const signEd25519 = async (key: CryptoKey, message: string): Promise<ArrayBuffer> => crypto.subtle.sign('Ed25519', key, encoder.encode(message));
