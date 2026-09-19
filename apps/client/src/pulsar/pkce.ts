import i18next from 'i18next';
import type { ProviderId } from '@ruimte/pulsar';

/*
 * The pure half of signing in: a PKCE pair, the state, the start URL and what the redirect came back
 * with. Only WebCrypto and `URL`, which a browser, Bun and a phone's JavaScript all have, so the mobile
 * app runs the same login as the desktop app does.
 */

const base64url = (bytes: Uint8Array): string => {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

/* Random bytes in base64url; 32 make a verifier of 43 characters, the shortest RFC 7636 allows. */
export const randomToken = (bytes = 32): string => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

export interface Pkce {
    verifier: string;
    challenge: string;
}

export const createPkce = async (): Promise<Pkce> => {
    const verifier = randomToken(32);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return { verifier, challenge: base64url(new Uint8Array(digest)) };
};

// 24 bytes, well past the 12 the address book asks for, so a state is never worth guessing.
export const createLoginState = (): string => randomToken(24);

export interface LoginStart {
    addressBookUrl: string;
    provider: ProviderId;
    redirectUri: string;
    state: string;
    challenge: string;
    /* A link token: the login adds this provider to the signed-in account instead of opening a session. */
    link?: string;
}

export const loginStartUrl = (start: LoginStart): string => {
    const url = new URL(`/auth/${start.provider}/start`, start.addressBookUrl);
    url.search = new URLSearchParams({
        redirect_uri: start.redirectUri,
        state: start.state,
        code_challenge: start.challenge,
        code_challenge_method: 'S256',
        ...(start.link === undefined ? {} : { link: start.link })
    }).toString();
    return url.toString();
};

/* The query the address book sent the browser back with. */
export interface LoginCallback {
    code: string | null;
    state: string | null;
    error: string | null;
}

export class LoginError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LoginError';
    }
}

/*
 * The code, when the redirect belongs to this login. A state that is not the one this login made is
 * refused before its code is looked at: it is another login's answer, or somebody else's, and trading
 * it would sign this app in to an account nobody here chose.
 */
export const codeFromCallback = (callback: LoginCallback, expectedState: string): string => {
    if (callback.state !== expectedState) {
        throw new LoginError(i18next.t('machines:signIn.wrongCallback'));
    }
    if (callback.error !== null) {
        throw new LoginError(
            callback.error === 'access_denied' ? i18next.t('machines:signIn.cancelled') : i18next.t('machines:signIn.failed', { error: callback.error })
        );
    }
    if (!callback.code) {
        throw new LoginError(i18next.t('machines:signIn.noCode'));
    }
    return callback.code;
};
