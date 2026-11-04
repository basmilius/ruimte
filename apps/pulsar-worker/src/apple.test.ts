import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setSystemTime, spyOn, test, type Mock } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { sha256, toBase64Url } from '@ruimte/pulsar';
import { apple, APPLE_ISSUER } from './apple.ts';
import type { Env } from './env.ts';

const NOW = 1_900_000_000_000;
const NOW_S = NOW / 1000;
const CLIENT_ID = 'app.ruimte.web.test';
const KID = 'apple-key';
const VERIFIER = 'the code verifier of this login';
const encoder = new TextEncoder();

const env = {
    PUBLIC_ORIGIN: 'https://pulsar.test',
    APPLE_TEAM_ID: 'team',
    APPLE_KEY_ID: 'portal-key',
    APPLE_PRIVATE_KEY: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    APPLE_CLIENT_ID: CLIENT_ID
} as Env;

let appleKeys: CryptoKeyPair;
let otherKeys: CryptoKeyPair;
let idToken: string;
let fetched: Mock<typeof fetch>;

function part(value: unknown): string {
    return toBase64Url(encoder.encode(JSON.stringify(value)));
}

function rsaPair(): Promise<CryptoKeyPair> {
    return crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, [
        'sign',
        'verify'
    ]);
}

async function signed(claims: Record<string, unknown>, key = appleKeys.privateKey): Promise<string> {
    const signingInput = `${part({ alg: 'RS256', kid: KID })}.${part(claims)}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(signingInput));

    return `${signingInput}.${toBase64Url(signature)}`;
}

async function claims(changes: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return { iss: APPLE_ISSUER, aud: CLIENT_ID, exp: NOW_S + 600, sub: 'apple-subject', nonce: await sha256(VERIFIER), ...changes };
}

function identify(): Promise<{ subject: string }> {
    return apple.identify(env, { code: 'code', codeVerifier: VERIFIER, redirectUri: 'https://pulsar.test/callback', callback: new URLSearchParams() });
}

beforeAll(async () => {
    [appleKeys, otherKeys] = await Promise.all([rsaPair(), rsaPair()]);
});

beforeEach(async () => {
    setSystemTime(new Date(NOW));
    const jwk = { ...(await crypto.subtle.exportKey('jwk', appleKeys.publicKey)), kid: KID };
    fetched = spyOn(globalThis, 'fetch').mockImplementation((async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : String(input);

        if (url.endsWith('/auth/keys')) {
            return Response.json({ keys: [jwk] });
        }

        return Response.json({ id_token: idToken });
    }) as typeof fetch);
});

afterEach(() => {
    fetched.mockRestore();
});

afterAll(() => {
    setSystemTime();
});

describe('the id_token of a Sign in with Apple', () => {
    test('a token Apple signed for this client, unexpired and with this login nonce, names its subject', async () => {
        idToken = await signed(await claims());
        expect((await identify()).subject).toBe('apple-subject');
    });

    test('an expired token is refused', async () => {
        idToken = await signed(await claims({ exp: NOW_S - 61 }));
        await expect(identify()).rejects.toThrow('expired');
    });

    test('a token signed with another key is refused', async () => {
        idToken = await signed(await claims(), otherKeys.privateKey);
        await expect(identify()).rejects.toThrow('not signed by Apple');
    });

    test('a token for another audience is refused', async () => {
        idToken = await signed(await claims({ aud: 'app.ruimte.someone-else' }));
        await expect(identify()).rejects.toThrow('another issuer or audience');
    });

    test('a token from another issuer is refused', async () => {
        idToken = await signed(await claims({ iss: 'https://issuer.test' }));
        await expect(identify()).rejects.toThrow('another issuer or audience');
    });

    test('a malformed token is refused before any key is fetched', async () => {
        for (const token of ['not-a-jwt', `${part({ alg: 'none', kid: KID })}.${part(await claims())}.`]) {
            idToken = token;
            await expect(identify()).rejects.toThrow('cannot read');
        }
        expect(fetched.mock.calls.some(([input]) => String(input).endsWith('/auth/keys'))).toBe(false);
    });
});
