import { randomToken, sha256, type ProviderId } from '@ruimte/pulsar';
import i18next from 'i18next';

/* The pure half of signing in, on WebCrypto and `URL` only, so the desktop app and the web client share it. */

interface Pkce {
    verifier: string;
    challenge: string;
}

export async function createPkce(): Promise<Pkce> {
    const verifier = randomToken(32);
    // The very hash the address book takes the verifier through when it checks the trade.
    return { verifier, challenge: await sha256(verifier) };
}

// 24 bytes, well past the 12 the address book asks for, so a state is never worth guessing.
export function createLoginState(): string {
    return randomToken(24);
}

export interface LoginStart {
    addressBookUrl: string;
    provider: ProviderId;
    redirectUri: string;
    state: string;
    challenge: string;
    /* A link token: the login adds this provider to the signed-in account instead of opening a session. */
    link?: string;
}

export function loginStartUrl(start: LoginStart): string {
    const url = new URL(`/auth/${start.provider}/start`, start.addressBookUrl);
    url.search = new URLSearchParams({
        redirect_uri: start.redirectUri,
        state: start.state,
        code_challenge: start.challenge,
        code_challenge_method: 'S256',
        ...(start.link === undefined ? {} : { link: start.link })
    }).toString();
    return url.toString();
}

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
export function codeFromCallback(callback: LoginCallback, expectedState: string): string {
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
}
