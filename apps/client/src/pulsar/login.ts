import type { ProviderId } from '@ruimte/pulsar';
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
 * system browser, the redirect checked against the state, and the code traded by the keeper, which
 * keeps the refresh token that comes back.
 */
export const signIn = async (options: SignInOptions): Promise<SessionView> => {
    const pkce = await createPkce();
    const state = createLoginState();
    const { redirectUri } = await options.redirect.listen();
    try {
        await options.redirect.open(
            loginStartUrl({ addressBookUrl: options.addressBookUrl, provider: options.provider ?? 'github', redirectUri, state, challenge: pkce.challenge })
        );
    } catch (e) {
        await options.redirect.cancel().catch(() => undefined);
        throw e;
    }
    const code = codeFromCallback(await options.redirect.callback(), state);
    return options.keeper.exchange({ code, codeVerifier: pkce.verifier, redirectUri, label: options.label.slice(0, 80) });
};
