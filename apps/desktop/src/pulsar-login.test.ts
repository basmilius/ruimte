import { describe, expect, test } from 'bun:test';
import { isAppRedirectUri } from '@ruimte/pulsar';
import { listenForLogin } from './pulsar-login';

describe('listenForLogin', () => {
    test('listens on a loopback redirect the address book accepts, and hands over the first callback', async () => {
        const login = await listenForLogin();
        expect(isAppRedirectUri(login.redirectUri)).toBe(true);

        const answer = await fetch(`${login.redirectUri}?code=the-code&state=the-state`);
        expect(answer.status).toBe(200);
        expect(await login.callback).toEqual({ code: 'the-code', state: 'the-state', error: null });

        // The port is gone the moment the code is read.
        expect(await fetch(`${login.redirectUri}?code=another&state=the-state`).catch(() => null)).toBeNull();
    });

    test('another path is not the callback and leaves the login waiting', async () => {
        const login = await listenForLogin();
        const origin = new URL(login.redirectUri).origin;
        expect((await fetch(`${origin}/favicon.ico`)).status).toBe(404);
        expect((await fetch(`${origin}/pulsar/callback/extra?code=x`)).status).toBe(404);

        const answer = await fetch(`${login.redirectUri}?error=access_denied&state=the-state`);
        expect(await answer.text()).toContain('did not work');
        expect(await login.callback).toEqual({ code: null, state: 'the-state', error: 'access_denied' });
    });

    test('a login that waits too long, or is cancelled, rejects and closes the port', async () => {
        const slow = await listenForLogin({ timeoutMs: 20 });
        expect(slow.callback).rejects.toThrow('took too long');
        await slow.callback.catch(() => undefined);
        expect(await fetch(slow.redirectUri).catch(() => null)).toBeNull();

        const cancelled = await listenForLogin();
        cancelled.cancel();
        expect(cancelled.callback).rejects.toThrow('cancelled');
        await cancelled.callback.catch(() => undefined);
        expect(await fetch(cancelled.redirectUri).catch(() => null)).toBeNull();
    });
});
