import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { fromBase64Url, toBase64Url } from '@ruimte/pulsar';
import { decodeJwt, importP8, signEs256Jwt, verifyRs256 } from './jwt.ts';

const encoder = new TextEncoder();

function part(value: unknown): string {
    return toBase64Url(encoder.encode(JSON.stringify(value)));
}

async function rsaPair(): Promise<CryptoKeyPair> {
    return crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, [
        'sign',
        'verify'
    ]);
}

// Node's and the Workers' JsonWebKey types differ only in which members are optional.
async function publicJwk(pair: CryptoKeyPair): Promise<JsonWebKey> {
    return (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
}

async function signRs256(key: CryptoKey, payload: Record<string, unknown>): Promise<string> {
    const signingInput = `${part({ alg: 'RS256', kid: 'key-1' })}.${part(payload)}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(signingInput));

    return `${signingInput}.${toBase64Url(signature)}`;
}

describe('decodeJwt', () => {
    test('reads the header, the claims and what was signed', () => {
        const token = `${part({ alg: 'RS256' })}.${part({ sub: 'someone' })}.${toBase64Url(new Uint8Array([1, 2, 3]))}`;
        const decoded = decodeJwt(token);
        expect(decoded?.header).toEqual({ alg: 'RS256' });
        expect(decoded?.payload).toEqual({ sub: 'someone' });
        expect(decoded?.signingInput).toBe(token.split('.').slice(0, 2).join('.'));
        expect([...(decoded?.signature ?? [])]).toEqual([1, 2, 3]);
    });

    test('a malformed token is no token', () => {
        const header = part({ alg: 'RS256' });
        const claims = part({ sub: 'someone' });
        for (const token of [
            '',
            'one-part',
            `${header}.${claims}`,
            `${header}.${claims}.sig.extra`,
            `${header}.${claims}.not+base64url`,
            `${toBase64Url(encoder.encode('{not json'))}.${claims}.sig`,
            `${header}.${part('a string')}.sig`,
            `${part(null)}.${claims}.sig`
        ]) {
            expect(decodeJwt(token)).toBeNull();
        }
    });
});

describe('verifyRs256', () => {
    test('a token signed with the key passes', async () => {
        const pair = await rsaPair();
        expect(await verifyRs256(await publicJwk(pair), decodeJwt(await signRs256(pair.privateKey, { sub: 'someone' }))!)).toBe(true);
    });

    test('a token signed with another key is refused', async () => {
        const [pair, other] = await Promise.all([rsaPair(), rsaPair()]);
        expect(await verifyRs256(await publicJwk(pair), decodeJwt(await signRs256(other.privateKey, { sub: 'someone' }))!)).toBe(false);
    });

    test('claims changed after signing are refused', async () => {
        const pair = await rsaPair();
        const [header, , signature] = (await signRs256(pair.privateKey, { sub: 'someone' })).split('.');
        expect(await verifyRs256(await publicJwk(pair), decodeJwt(`${header}.${part({ sub: 'somebody else' })}.${signature}`)!)).toBe(false);
    });

    test('a key that is no RSA key refuses instead of throwing', async () => {
        const pair = await rsaPair();
        const decoded = decodeJwt(await signRs256(pair.privateKey, { sub: 'someone' }))!;
        expect(await verifyRs256({ kty: 'EC', crv: 'P-256', x: 'AA', y: 'AA' }, decoded)).toBe(false);
    });
});

describe('signEs256Jwt', () => {
    test('signs with a .p8 key what its public half verifies, as raw r and s', async () => {
        const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
        const pem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
        const token = await signEs256Jwt(await importP8(pem), { kid: 'key-1' }, { iss: 'team' });
        const decoded = decodeJwt(token)!;
        const publicKey = await crypto.subtle.importKey('jwk', pair.publicKey.export({ format: 'jwk' }), { name: 'ECDSA', namedCurve: 'P-256' }, false, [
            'verify'
        ]);
        expect(decoded.header).toEqual({ kid: 'key-1', alg: 'ES256', typ: 'JWT' });
        expect(decoded.payload).toEqual({ iss: 'team' });
        expect(decoded.signature).toHaveLength(64);
        expect(
            await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, fromBase64Url(token.split('.')[2]!), encoder.encode(decoded.signingInput))
        ).toBe(true);
    });
});
