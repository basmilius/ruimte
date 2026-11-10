import type { ProviderId } from '@ruimte/pulsar';
import { apple } from './apple.ts';
import { cleanDisplayName } from './display-name.ts';
import type { OAuthProvider } from './oauth-provider.ts';

const USER_AGENT = 'ruimte-pulsar';

const github: OAuthProvider = {
    id: 'github',
    callbackMethod: 'GET',
    configured(env) {
        return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
    },
    authorizeUrl(env, input) {
        // No scope: the numeric user id, the login and the public name come with any token.
        const url = new URL('https://github.com/login/oauth/authorize');
        url.searchParams.set('client_id', env.GITHUB_CLIENT_ID ?? '');
        url.searchParams.set('redirect_uri', input.redirectUri);
        url.searchParams.set('state', input.state);
        url.searchParams.set('code_challenge', input.codeChallenge);
        url.searchParams.set('code_challenge_method', 'S256');
        url.searchParams.set('allow_signup', 'true');
        return url.toString();
    },
    async identify(env, input) {
        const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT },
            body: new URLSearchParams({
                client_id: env.GITHUB_CLIENT_ID ?? '',
                client_secret: env.GITHUB_CLIENT_SECRET ?? '',
                code: input.code,
                redirect_uri: input.redirectUri,
                code_verifier: input.codeVerifier
            })
        });
        const token = (await tokenResponse.json().catch(() => null)) as { access_token?: unknown; error?: unknown } | null;
        if (!tokenResponse.ok || typeof token?.access_token !== 'string') {
            throw new Error(`GitHub refused the code: ${typeof token?.error === 'string' ? token.error : tokenResponse.status}`);
        }
        const userResponse = await fetch('https://api.github.com/user', {
            headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token.access_token}`, 'user-agent': USER_AGENT }
        });
        const user = (await userResponse.json().catch(() => null)) as { id?: unknown; login?: unknown; name?: unknown } | null;
        if (!userResponse.ok || typeof user?.id !== 'number') {
            throw new Error(`GitHub did not say who signed in: ${userResponse.status}`);
        }
        // The GitHub token is dropped here: the address book never acts on GitHub for anyone.
        return { subject: String(user.id), login: typeof user.login === 'string' ? user.login : null, displayName: cleanDisplayName(user.name) };
    }
};

export const PROVIDERS: Record<ProviderId, OAuthProvider> = { github, apple };
