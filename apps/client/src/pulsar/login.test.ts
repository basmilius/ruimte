import { describe, expect, test } from 'bun:test';
import { LoginStartQuerySchema, type SessionExchangePayload } from '@ruimte/pulsar';
import { signIn, type LoginRedirect } from './login';
import type { LoginCallback } from './pkce';
import type { SessionKeeper, SessionView } from './session';

const REDIRECT = 'http://127.0.0.1:53682/pulsar/callback';
const account = { id: 'account-1', provider: 'github' as const, login: 'someone' };

/* The browser and the address book in one: it reads the start URL and answers the redirect it was told to. */
const fakeRoute = (answer: (state: string) => LoginCallback) => {
    const opened: string[] = [];
    let cancelled = 0;
    let state = '';
    const redirect: LoginRedirect = {
        listen: async () => ({ redirectUri: REDIRECT }),
        open: async (url) => {
            opened.push(url);
            state = LoginStartQuerySchema.parse(Object.fromEntries(new URL(url).searchParams)).state;
        },
        callback: async () => answer(state),
        cancel: async () => {
            cancelled += 1;
        }
    };
    const exchanged: SessionExchangePayload[] = [];
    const keeper: SessionKeeper = {
        exchange: async (payload) => {
            exchanged.push(payload);
            return { accessToken: 'a'.repeat(43), accessExpiresAt: 1, expiresAt: 2, account } satisfies SessionView;
        },
        refresh: async () => null,
        restore: async () => null,
        signOut: async () => undefined
    };
    return { redirect, keeper, opened, exchanged, cancelled: () => cancelled };
};

describe('signIn', () => {
    test('opens the start URL with a challenge and trades the code with the verifier that belongs to it', async () => {
        const route = fakeRoute((state) => ({ code: 'the-code', state, error: null }));
        const view = await signIn({ redirect: route.redirect, keeper: route.keeper, addressBookUrl: 'https://pulsar.ruimte.app', label: 'Ruimte on macOS' });
        expect(view.account).toEqual(account);
        const start = new URL(route.opened[0]!);
        expect(start.pathname).toBe('/auth/github/start');
        const exchanged = route.exchanged[0]!;
        expect(exchanged).toMatchObject({ code: 'the-code', redirectUri: REDIRECT, label: 'Ruimte on macOS' });
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(exchanged.codeVerifier)));
        const challenge = btoa(String.fromCharCode(...digest))
            .replaceAll('+', '-')
            .replaceAll('/', '_')
            .replace(/=+$/, '');
        expect(start.searchParams.get('code_challenge')).toBe(challenge);
    });

    test('a redirect with another state trades nothing', async () => {
        const route = fakeRoute(() => ({ code: 'stolen', state: 'someone-elses', error: null }));
        expect(signIn({ redirect: route.redirect, keeper: route.keeper, addressBookUrl: 'https://pulsar.ruimte.app', label: 'x' })).rejects.toThrow(
            'does not belong'
        );
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(route.exchanged).toEqual([]);
    });

    test('a browser that will not open gives the listener up', async () => {
        const route = fakeRoute((state) => ({ code: 'c', state, error: null }));
        route.redirect.open = async () => {
            throw new Error('no browser');
        };
        expect(signIn({ redirect: route.redirect, keeper: route.keeper, addressBookUrl: 'https://pulsar.ruimte.app', label: 'x' })).rejects.toThrow(
            'no browser'
        );
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(route.cancelled()).toBe(1);
    });
});
