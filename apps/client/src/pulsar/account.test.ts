import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { deletePulsarAccount, startPulsarAccount, usePulsarAccount } from './account';
import { useAccountConfirmation } from './confirmation';
import type { PulsarPlatform } from './desktop';

const account = { id: 'account-1', provider: 'github' as const, login: 'someone', displayName: null };
const realFetch = globalThis.fetch;

interface Sent {
    method: string;
    path: string;
    body: unknown;
}

const platformWith = () => {
    const calls = { signOuts: 0 };
    const platform: PulsarPlatform = {
        addressBook: async () => 'https://pulsar.test',
        keeper: {
            exchange: async () => {
                throw new Error('not used');
            },
            refresh: async () => ({ accessToken: 'a'.repeat(43), accessExpiresAt: Date.now() + 900_000, expiresAt: Date.now() + 86_400_000, account }),
            restore: async () => ({ account, expiresAt: Date.now() + 86_400_000 }),
            signOut: async () => {
                calls.signOuts += 1;
            }
        }
    };
    return { platform, calls };
};

const answerDeleteWith = (response: () => Response): Sent[] => {
    const sent: Sent[] = [];
    globalThis.fetch = (async (input: string, init: RequestInit) => {
        const path = new URL(input).pathname;
        if (path === '/v1/providers') {
            return Response.json({ providers: ['github'] });
        }
        sent.push({ method: init.method ?? 'GET', path, body: init.body === undefined ? undefined : JSON.parse(String(init.body)) });
        return response();
    }) as typeof fetch;
    return sent;
};

describe('deleting the account', () => {
    beforeEach(() => {
        useAccountConfirmation.setState({ text: null });
    });

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    test('sends the typed name, then signs out through the keeper and says so', async () => {
        const sent = answerDeleteWith(() => new Response(null, { status: 204 }));
        const { platform, calls } = platformWith();
        await startPulsarAccount(platform);
        expect(usePulsarAccount.getState().status).toBe('signed-in');

        await deletePulsarAccount('someone');

        expect(sent).toEqual([{ method: 'DELETE', path: '/v1/account', body: { confirmation: 'someone' } }]);
        expect(calls.signOuts).toBe(1);
        expect(usePulsarAccount.getState()).toMatchObject({ status: 'signed-out', account: null });
        expect(useAccountConfirmation.getState().text).toBe('Your Ruimte account is deleted, and this app signed out');
    });

    test('a name the address book refuses keeps the person signed in', async () => {
        answerDeleteWith(() => Response.json({ error: { code: 'confirmation-mismatch', message: 'Type someone to delete this account' } }, { status: 400 }));
        const { platform, calls } = platformWith();
        await startPulsarAccount(platform);

        await expect(deletePulsarAccount('somebody')).rejects.toThrow('Type someone to delete this account');

        expect(calls.signOuts).toBe(0);
        expect(usePulsarAccount.getState().status).toBe('signed-in');
        expect(useAccountConfirmation.getState().text).toBeNull();
    });
});
