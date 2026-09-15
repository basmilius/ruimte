import type { IdentityLinkCompletePayload, ProviderId } from '@ruimte/pulsar';
import { codeFromCallback, createLoginState, createPkce, loginStartUrl, type LoginCallback } from './pkce';
import type { SessionKeeper, SessionView } from './session';

/*
 * How a login leaves this client and comes back: a loopback listener in the desktop shell, a custom
 * scheme in the mobile app. The flow below does not care which.
 */
export interface LoginRedirect {
    listen(): Promise<{ redirectUri: string }>;
    /* Opens the start URL where the person can type a password: the system browser, not this page. */
    open(url: string): Promise<void>;
    callback(): Promise<LoginCallback>;
    cancel(): Promise<void>;
}

export interface SignInOptions {
    redirect: LoginRedirect;
    keeper: SessionKeeper;
    addressBookUrl: string;
    provider?: ProviderId;
    /* What the address book lists this device as in the log of who got access. */
    label: string;
}

/*
 * A redirect login with PKCE (RFC 8252): a verifier and a state made here, the start URL opened in the
 * system browser, and the redirect checked against the state. Answers the code with the verifier and
 * the redirect it belongs to, for whichever route trades it.
 */
const loginInBrowser = async (options: {
    redirect: LoginRedirect;
    addressBookUrl: string;
    provider: ProviderId;
    link?: string;
}): Promise<IdentityLinkCompletePayload> => {
    const pkce = await createPkce();
    const state = createLoginState();
    const { redirectUri } = await options.redirect.listen();
    try {
        await options.redirect.open(
            loginStartUrl({
                addressBookUrl: options.addressBookUrl,
                provider: options.provider,
                redirectUri,
                state,
                challenge: pkce.challenge,
                link: options.link
            })
        );
    } catch (e) {
        await options.redirect.cancel().catch(() => undefined);
        throw e;
    }
    const code = codeFromCallback(await options.redirect.callback(), state);
    return { code, codeVerifier: pkce.verifier, redirectUri };
};

/* Signing in: the code is traded by the keeper, which keeps the refresh token that comes back. */
export const signIn = async (options: SignInOptions): Promise<SessionView> => {
    const login = await loginInBrowser({ redirect: options.redirect, addressBookUrl: options.addressBookUrl, provider: options.provider ?? 'github' });
    return options.keeper.exchange({ ...login, label: options.label.slice(0, 80) });
};

export interface LinkIdentityOptions<T> {
    redirect: LoginRedirect;
    addressBookUrl: string;
    provider: ProviderId;
    /* A link token asked for with this client's session, so the login that follows is bound to it. */
    requestLink(): Promise<string>;
    /* Trades the code with the same session; the identity lands on the account only then. */
    complete(login: IdentityLinkCompletePayload): Promise<T>;
}

/* Adding a provider to the signed-in account: the same login, started with a link token and ended with the session rather than the keeper. */
export const linkIdentity = async <T>(options: LinkIdentityOptions<T>): Promise<T> => {
    const link = await options.requestLink();
    return options.complete(await loginInBrowser({ redirect: options.redirect, addressBookUrl: options.addressBookUrl, provider: options.provider, link }));
};
