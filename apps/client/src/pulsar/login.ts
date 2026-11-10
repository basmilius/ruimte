import { clipText } from '@ruimte/contracts';
import type { IdentityLinkCompletePayload, ProviderId } from '@ruimte/pulsar';
import { fireAndForget } from '@/transport-api/transport';
import { codeFromCallback, createLoginState, createPkce, loginStartUrl, type LoginCallback } from './pkce';
import type { SessionKeeper, SessionView } from './session';

export interface LoginRedirect {
    listen(): Promise<{ redirectUri: string }>;
    /* Opens the start URL where the person can type a password: the system browser, not this page. */
    open(url: string): Promise<void>;
    callback(): Promise<LoginCallback>;
    cancel(): Promise<void>;
}

interface SignInOptions {
    redirect: LoginRedirect;
    keeper: SessionKeeper;
    addressBookUrl: string;
    provider?: ProviderId;
    label: string;
}

/*
 * A redirect login with PKCE (RFC 8252): a verifier and a state made here, the start URL opened in the
 * system browser, and the redirect checked against the state. Answers the code with the verifier and
 * the redirect it belongs to, for whichever route trades it.
 */
async function loginInBrowser(options: {
    redirect: LoginRedirect;
    addressBookUrl: string;
    provider: ProviderId;
    link?: string;
}): Promise<IdentityLinkCompletePayload> {
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
        await fireAndForget('options.redirect.cancel', options.redirect.cancel());
        throw e;
    }
    const code = codeFromCallback(await options.redirect.callback(), state);
    return { code, codeVerifier: pkce.verifier, redirectUri };
}

export async function signIn(options: SignInOptions): Promise<SessionView> {
    const login = await loginInBrowser({ redirect: options.redirect, addressBookUrl: options.addressBookUrl, provider: options.provider ?? 'github' });
    return options.keeper.exchange({ ...login, label: clipText(options.label, 80) });
}

interface LinkIdentityOptions<T> {
    redirect: LoginRedirect;
    addressBookUrl: string;
    provider: ProviderId;
    /* A link token asked for with this client's session, so the login that follows is bound to it. */
    requestLink(): Promise<string>;
    complete(login: IdentityLinkCompletePayload): Promise<T>;
}

/* Adding a provider to the signed-in account: the same login, started with a link token and ended with the session rather than the keeper. */
export async function linkIdentity<T>(options: LinkIdentityOptions<T>): Promise<T> {
    const link = await options.requestLink();
    return options.complete(await loginInBrowser({ redirect: options.redirect, addressBookUrl: options.addressBookUrl, provider: options.provider, link }));
}
