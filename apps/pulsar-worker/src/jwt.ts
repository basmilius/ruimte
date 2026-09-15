import { fromBase64Url, toBase64Url } from './encoding.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const encodeJson = (value: unknown): string => toBase64Url(encoder.encode(JSON.stringify(value)));

export interface DecodedJwt {
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
    signingInput: string;
    signature: Uint8Array<ArrayBuffer>;
}

// Null for anything that is not three base64url parts with JSON objects in the first two.
export const decodeJwt = (token: string): DecodedJwt | null => {
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]*$/.test(part))) {
        return null;
    }
    const [header, payload, signature] = parts as [string, string, string];
    try {
        const decodedHeader: unknown = JSON.parse(decoder.decode(fromBase64Url(header)));
        const decodedPayload: unknown = JSON.parse(decoder.decode(fromBase64Url(payload)));
        if (typeof decodedHeader !== 'object' || decodedHeader === null || typeof decodedPayload !== 'object' || decodedPayload === null) {
            return null;
        }
        return {
            header: decodedHeader as Record<string, unknown>,
            payload: decodedPayload as Record<string, unknown>,
            signingInput: `${header}.${payload}`,
            signature: fromBase64Url(signature)
        };
    } catch {
        return null;
    }
};

/*
 * An ES256 JWT. WebCrypto's ECDSA signature is already the raw r and s JWS expects (RFC 7518, 3.4),
 * so there is no DER to unwrap.
 */
export const signEs256Jwt = async (key: CryptoKey, header: Record<string, unknown>, payload: Record<string, unknown>): Promise<string> => {
    const signingInput = `${encodeJson({ ...header, alg: 'ES256', typ: 'JWT' })}.${encodeJson(payload)}`;
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(signingInput));
    return `${signingInput}.${toBase64Url(signature)}`;
};

export const verifyRs256 = async (jwk: JsonWebKey, jwt: DecodedJwt): Promise<boolean> => {
    try {
        const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
        return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, jwt.signature, encoder.encode(jwt.signingInput));
    } catch {
        return false;
    }
};
