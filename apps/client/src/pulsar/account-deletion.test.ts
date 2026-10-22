import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { startPulsarAccount, usePulsarAccount } from './account';
import { deleteAccountHere, type LocalLeave } from './account-deletion';
import { useAccountConfirmation } from './confirmation';
import type { PulsarPlatform } from './desktop';

const account = { id: 'account-1', provider: 'github' as const, login: 'someone', displayName: null };
const realFetch = globalThis.fetch;
const NOW = Date.UTC(2026, 9, 1);

interface Sent {
    method: string;
    path: string;
    body: unknown;
}

function platformWith() {
    const calls = { signOuts: 0 };
    const platform: PulsarPlatform = {
        addressBook: async () => 'https://pulsar.test',
        keeper: {
            exchange: async () => {
                throw new Error('not used');
            },
            refresh: async () => ({ accessToken: 'a'.repeat(43), accessExpiresAt: NOW + 900_000, expiresAt: NOW + 86_400_000, account }),
            restore: async () => ({ account, expiresAt: NOW + 86_400_000 }),
            signOut: async () => {
                calls.signOuts += 1;
            }
        }
    };
    return { platform, calls };
}

function answerDeleteWith(response: () => Response): Sent[] {
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
}

describe('deleting the account', () => {
    beforeEach(() => {
        setSystemTime(NOW);
        useAccountConfirmation.setState({ text: null });
    });

    afterEach(() => {
        setSystemTime();
        globalThis.fetch = realFetch;
    });

    test('sends the typed name, signs out through the keeper and takes this computer off the account', async () => {
        const sent = answerDeleteWith(() => new Response(null, { status: 204 }));
        const { platform, calls } = platformWith();
        await startPulsarAccount(platform);
        expect(usePulsarAccount.getState().status).toBe('signed-in');
        const left: string[] = [];

        await deleteAccountHere('someone', async (accountId) => {
            left.push(accountId);
            return 'left';
        });

        expect(sent).toEqual([{ method: 'DELETE', path: '/v1/account', body: { confirmation: 'someone' } }]);
        expect(calls.signOuts).toBe(1);
        expect(left).toEqual(['account-1']);
        expect(usePulsarAccount.getState()).toMatchObject({ status: 'signed-out', account: null });
        expect(useAccountConfirmation.getState().text).toBe("Account deleted, signed out, and this computer's machine left it");
    });

    test('says when this computer was on no account, and when it could not leave', async () => {
        const said = async (outcome: LocalLeave): Promise<string | null> => {
            answerDeleteWith(() => new Response(null, { status: 204 }));
            await startPulsarAccount(platformWith().platform);
            await deleteAccountHere('someone', async () => outcome);
            return useAccountConfirmation.getState().text;
        };
        expect(await said('not-on-it')).toBe('Account deleted and signed out');
        expect(await said('failed')).toBe(
            "Account deleted and signed out, but this computer's machine is still on it. Remove it under Settings › Account before signing in again."
        );
    });

    test('a name the address book refuses keeps the person signed in', async () => {
        answerDeleteWith(() => Response.json({ error: { code: 'confirmation-mismatch', message: 'Type someone to delete this account' } }, { status: 400 }));
        const { platform, calls } = platformWith();
        await startPulsarAccount(platform);

        const left: string[] = [];
        await expect(
            deleteAccountHere('somebody', async (accountId) => {
                left.push(accountId);
                return 'left';
            })
        ).rejects.toThrow('Type someone to delete this account');

        expect(left).toEqual([]);

        expect(calls.signOuts).toBe(0);
        expect(usePulsarAccount.getState().status).toBe('signed-in');
        expect(useAccountConfirmation.getState().text).toBeNull();
    });
});
