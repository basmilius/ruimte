import { describe, expect, test } from 'bun:test';
import { AccessTokens, ACCESS_TOKEN_MARGIN_MS, type SessionKeeper, type SessionView } from './session';

const account = { id: 'account-1', provider: 'github' as const, login: 'someone' };
const NOW = 1_800_000_000_000;

const viewFor = (accessToken: string, accessExpiresAt: number): SessionView => ({ accessToken, accessExpiresAt, expiresAt: NOW + 86_400_000, account });

const keeperWith = (answers: Array<SessionView | null>) => {
    const keeper = {
        refreshes: 0,
        exchange: async () => viewFor('x'.repeat(43), NOW),
        refresh: async () => {
            keeper.refreshes += 1;
            await new Promise((resolve) => setTimeout(resolve, 1));
            return answers.shift() ?? null;
        },
        restore: async () => null,
        signOut: async () => undefined
    } satisfies SessionKeeper & { refreshes: number };
    return keeper;
};

describe('AccessTokens', () => {
    test('a token with time left is used as it is, and one close to its end is refreshed first', async () => {
        let now = NOW;
        const keeper = keeperWith([viewFor('fresh', NOW + 900_000)]);
        const tokens = new AccessTokens(keeper, { now: () => now });
        tokens.set(viewFor('current', NOW + 900_000));
        expect(await tokens.token()).toBe('current');
        expect(keeper.refreshes).toBe(0);

        now = NOW + 900_000 - ACCESS_TOKEN_MARGIN_MS;
        expect(await tokens.token()).toBe('fresh');
        expect(keeper.refreshes).toBe(1);
    });

    test('three callers at once share one refresh', async () => {
        const keeper = keeperWith([viewFor('fresh', NOW + 900_000), viewFor('second', NOW + 900_000)]);
        const tokens = new AccessTokens(keeper, { now: () => NOW });
        expect(await Promise.all([tokens.token(), tokens.token(), tokens.token()])).toEqual(['fresh', 'fresh', 'fresh']);
        expect(keeper.refreshes).toBe(1);
    });

    test('a keeper with no session left answers null and says so once', async () => {
        const keeper = keeperWith([null]);
        let signedOut = 0;
        const tokens = new AccessTokens(keeper, { now: () => NOW, onSignedOut: () => (signedOut += 1) });
        expect(await tokens.token()).toBeNull();
        expect(signedOut).toBe(1);
    });
});
