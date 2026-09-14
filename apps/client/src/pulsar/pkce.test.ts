import { describe, expect, test } from 'bun:test';
import { LoginStartQuerySchema } from '@ruimte/pulsar';
import { LoginError, codeFromCallback, createLoginState, createPkce, loginStartUrl } from './pkce';

const sha256 = async (text: string): Promise<string> =>
    btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '');

describe('PKCE and state', () => {
    test('a verifier is 43 characters of base64url and the challenge is its SHA-256', async () => {
        const pkce = await createPkce();
        expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(pkce.challenge).toBe(await sha256(pkce.verifier));
        expect((await createPkce()).verifier).not.toBe(pkce.verifier);
    });

    test('a state is fresh every time and long enough for the address book', () => {
        const state = createLoginState();
        expect(state).toMatch(/^[A-Za-z0-9_-]{32}$/);
        expect(createLoginState()).not.toBe(state);
    });

    test('the start URL is one the address book accepts, for the provider asked', async () => {
        const pkce = await createPkce();
        const state = createLoginState();
        const url = new URL(
            loginStartUrl({
                addressBookUrl: 'https://pulsar.ruimte.app',
                provider: 'github',
                redirectUri: 'http://127.0.0.1:53682/pulsar/callback',
                state,
                challenge: pkce.challenge
            })
        );
        expect(url.origin + url.pathname).toBe('https://pulsar.ruimte.app/auth/github/start');
        const query = LoginStartQuerySchema.parse(Object.fromEntries(url.searchParams));
        expect(query).toEqual({ redirect_uri: 'http://127.0.0.1:53682/pulsar/callback', state, code_challenge: pkce.challenge, code_challenge_method: 'S256' });
    });
});

describe('codeFromCallback', () => {
    test('hands over the code of a redirect with this login state', () => {
        expect(codeFromCallback({ code: 'the-code', state: 'mine', error: null }, 'mine')).toBe('the-code');
    });

    test('refuses a redirect with another state before it looks at the code or the error', () => {
        expect(() => codeFromCallback({ code: 'the-code', state: 'theirs', error: null }, 'mine')).toThrow(LoginError);
        expect(() => codeFromCallback({ code: 'the-code', state: null, error: null }, 'mine')).toThrow('does not belong to this sign-in');
        expect(() => codeFromCallback({ code: null, state: 'theirs', error: 'access_denied' }, 'mine')).toThrow('does not belong to this sign-in');
    });

    test('says what the provider said, and refuses a redirect without a code', () => {
        expect(() => codeFromCallback({ code: null, state: 'mine', error: 'access_denied' }, 'mine')).toThrow('cancelled');
        expect(() => codeFromCallback({ code: null, state: 'mine', error: 'server_error' }, 'mine')).toThrow('server_error');
        expect(() => codeFromCallback({ code: '', state: 'mine', error: null }, 'mine')).toThrow('without a sign-in code');
    });
});
