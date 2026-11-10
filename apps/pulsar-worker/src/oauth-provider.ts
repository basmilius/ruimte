import type { ProviderId } from '@ruimte/pulsar';
import type { Env } from './env.ts';

export interface ProviderIdentity {
    // The provider's own user id, stable across a rename and never an email.
    subject: string;
    login: string | null;
    // `null` when the provider did not say, which never clears a name stored before.
    displayName: string | null;
}

/*
 * One sign-in provider. Everything around it (the state, both PKCE legs, the app's redirect, the
 * account and its identities) is the same for every provider, so a provider is one entry in `PROVIDERS`.
 */
export interface OAuthProvider {
    readonly id: ProviderId;
    /*
     * How the provider sends the browser back. A `POST` is a cross-site form post, which a `SameSite=Lax`
     * cookie does not ride along with, so the login cookie is `SameSite=None` for such a provider.
     */
    readonly callbackMethod: 'GET' | 'POST';
    configured(env: Env): boolean;
    /* `codeChallenge` is the SHA-256 of the verifier `identify` gets: a PKCE challenge, or a nonce for a provider without PKCE. */
    authorizeUrl(env: Env, input: { state: string; codeChallenge: string; redirectUri: string }): string;
    /*
     * Throws when the provider refuses the code; the caller turns that into an error for the app.
     * `callback` is everything the provider sent back, for a provider that says more there than in its token.
     */
    identify(env: Env, input: { code: string; codeVerifier: string; redirectUri: string; callback: URLSearchParams }): Promise<ProviderIdentity>;
}
