import { APPLE_NATIVE_CLIENT_ID } from '@ruimte/pulsar';
import { sha256 } from './encoding.ts';
import type { Env } from './env.ts';
import { decodeJwt, signEs256Jwt, verifyRs256 } from './jwt.ts';
import type { OAuthProvider } from './providers.ts';

export const APPLE_ISSUER = 'https://appleid.apple.com';
const AUTHORIZE_URL = 'https://appleid.apple.com/auth/authorize';
const TOKEN_URL = 'https://appleid.apple.com/auth/token';
const KEYS_URL = 'https://appleid.apple.com/auth/keys';

// Apple allows six months; an hour is plenty for one exchange and keeps a secret that leaks from a log short-lived.
const CLIENT_SECRET_LIFETIME_S = 60 * 60;
// Apple rotates its signing keys rarely; a key id this isolate has not seen fetches the set again anyway.
const KEYS_LIFETIME_MS = 60 * 60_000;
// Room for a clock between Apple and the Worker that is a little off.
const CLOCK_SKEW_S = 60;

let signingKey: { secret: string; key: Promise<CryptoKey> } | null = null;

// The .p8 file as Apple hands it out: PKCS #8 in PEM, standard base64 between the armor lines.
const importP8 = async (pem: string): Promise<CryptoKey> => {
    const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
    const der = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
    return crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
};

const signingKeyOf = (secret: string): Promise<CryptoKey> => {
    if (signingKey?.secret !== secret) {
        signingKey = { secret, key: importP8(secret) };
    }
    return signingKey.key;
};

// Apple has no static client secret: every token request carries a JWT signed with the key from the portal.
export const appleClientSecret = async (env: Env, now = Date.now(), clientId = env.APPLE_CLIENT_ID): Promise<string> => {
    const issuedAt = Math.floor(now / 1000);
    return signEs256Jwt(
        await signingKeyOf(env.APPLE_PRIVATE_KEY ?? ''),
        { kid: env.APPLE_KEY_ID },
        { iss: env.APPLE_TEAM_ID, iat: issuedAt, exp: issuedAt + CLIENT_SECRET_LIFETIME_S, aud: APPLE_ISSUER, sub: clientId }
    );
};

let keys: { fetchedAt: number; keys: JsonWebKey[] } | null = null;

const fetchKeys = async (): Promise<JsonWebKey[]> => {
    const response = await fetch(KEYS_URL, { headers: { accept: 'application/json' } });
    const body = (await response.json().catch(() => null)) as { keys?: unknown } | null;
    if (!response.ok || !Array.isArray(body?.keys)) {
        throw new Error(`Apple did not hand out its keys: ${response.status}`);
    }
    keys = { fetchedAt: Date.now(), keys: body.keys as JsonWebKey[] };
    return keys.keys;
};

const keyWithId = (set: JsonWebKey[], kid: string): JsonWebKey | undefined => set.find((key) => (key as { kid?: unknown }).kid === kid);

const appleKey = async (kid: string): Promise<JsonWebKey | undefined> => {
    const cached = keys && Date.now() - keys.fetchedAt < KEYS_LIFETIME_MS ? keyWithId(keys.keys, kid) : undefined;
    return cached ?? keyWithId(await fetchKeys(), kid);
};

/*
 * The `id_token` from the token endpoint, checked the way Apple's documentation asks: a signature from one
 * of Apple's keys, Apple as the issuer, an audience the caller accepts, not expired, and the nonce this
 * login sent. The token came straight from Apple over TLS, but checking it anyway costs one cached fetch.
 */
export const verifyAppleIdToken = async (idToken: string, input: { audiences: readonly string[]; nonce: string; now?: number }): Promise<string> => {
    const jwt = decodeJwt(idToken);
    if (!jwt || jwt.header.alg !== 'RS256' || typeof jwt.header.kid !== 'string') {
        throw new Error('Apple answered with an id_token this address book cannot read');
    }
    const key = await appleKey(jwt.header.kid);
    if (!key || !(await verifyRs256(key, jwt))) {
        throw new Error('The id_token is not signed by Apple');
    }
    const claims = jwt.payload;
    const nowS = Math.floor((input.now ?? Date.now()) / 1000);
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== APPLE_ISSUER || !audience.some((entry) => typeof entry === 'string' && input.audiences.includes(entry))) {
        throw new Error('The id_token is for another issuer or audience');
    }
    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp + CLOCK_SKEW_S <= nowS) {
        throw new Error('The id_token expired');
    }
    if (claims.nonce !== input.nonce) {
        throw new Error('The id_token belongs to another login');
    }
    if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
        throw new Error('The id_token names nobody');
    }
    return claims.sub;
};

export const nativeAppleConfigured = (env: Env): boolean => Boolean(env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY);

export const identifyNativeApple = async (env: Env, input: { identityToken: string; authorizationCode: string; nonce: string }): Promise<string> => {
    const verify = async (token: string): Promise<string> => {
        if (decodeJwt(token)?.payload.aud !== APPLE_NATIVE_CLIENT_ID) {
            throw new Error('The native Apple token is for another app');
        }
        return verifyAppleIdToken(token, { audiences: [APPLE_NATIVE_CLIENT_ID], nonce: input.nonce });
    };
    const subject = await verify(input.identityToken);
    // Native authorization has no redirect URI: https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens
    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: APPLE_NATIVE_CLIENT_ID,
            client_secret: await appleClientSecret(env, Date.now(), APPLE_NATIVE_CLIENT_ID),
            code: input.authorizationCode,
            grant_type: 'authorization_code'
        })
    });
    const token = (await response.json().catch(() => null)) as { id_token?: unknown } | null;
    if (!response.ok || typeof token?.id_token !== 'string' || (await verify(token.id_token)) !== subject) {
        throw new Error('Apple did not confirm this sign-in');
    }
    return subject;
};

/*
 * Apple web login uses a form post to keep the code out of URL logs. Apple has no web PKCE, so the
 * verifier hash travels as the nonce and must return in the identity token.
 */
export const apple: OAuthProvider = {
    id: 'apple',
    callbackMethod: 'POST',
    configured(env) {
        return Boolean(env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY && env.APPLE_CLIENT_ID);
    },
    authorizeUrl(env, input) {
        const url = new URL(AUTHORIZE_URL);
        url.searchParams.set('client_id', env.APPLE_CLIENT_ID ?? '');
        url.searchParams.set('redirect_uri', input.redirectUri);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('response_mode', 'form_post');
        url.searchParams.set('state', input.state);
        url.searchParams.set('nonce', input.codeChallenge);
        return url.toString();
    },
    async identify(env, input) {
        const clientId = env.APPLE_CLIENT_ID ?? '';
        const response = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: await appleClientSecret(env),
                code: input.code,
                grant_type: 'authorization_code',
                redirect_uri: input.redirectUri
            })
        });
        const token = (await response.json().catch(() => null)) as { id_token?: unknown; error?: unknown } | null;
        if (!response.ok || typeof token?.id_token !== 'string') {
            throw new Error(`Apple refused the code: ${typeof token?.error === 'string' ? token.error : response.status}`);
        }
        // Apple's access and refresh tokens are dropped with the response: the address book never acts on Apple for anyone.
        // The web flow's own Services ID only; a native app's token carries its bundle id and would pass its own list.
        const subject = await verifyAppleIdToken(token.id_token, { audiences: [clientId], nonce: await sha256(input.codeVerifier) });
        return { subject, login: null };
    }
};
