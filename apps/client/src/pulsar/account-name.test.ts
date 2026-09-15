import { describe, expect, test } from 'bun:test';
import { accountName, identityDetail, offeredProviders, signedInLabel, takeoverWarning } from './account-name';

describe('naming an account', () => {
    test('a login names the account, and an account without one is named after its provider', () => {
        expect(accountName({ id: 'a', provider: 'github', login: 'someone' })).toBe('someone');
        expect(accountName({ id: 'a', provider: 'apple', login: null })).toBe('your Apple ID');
        expect(signedInLabel({ id: 'a', provider: 'github', login: 'someone' })).toBe('Signed in as someone');
        expect(signedInLabel({ id: 'a', provider: 'apple', login: null })).toBe('Signed in with Apple');
        expect(identityDetail({ provider: 'apple', login: null, createdAt: 1 })).toBe('Apple ID');
        expect(identityDetail({ provider: 'github', login: 'someone', createdAt: 1 })).toBe('someone');
    });

    test('the warning names every identity that opens the account', () => {
        expect(takeoverWarning(['github'])).toBe(
            'Anyone who takes over this GitHub account can reach your machines, so turn on two-factor authentication there.'
        );
        expect(takeoverWarning(['apple', 'github'])).toBe(
            'Anyone who takes over this GitHub account or this Apple ID can reach your machines, so turn on two-factor authentication there.'
        );
    });

    test('only providers this client knows are offered, GitHub first', () => {
        expect(offeredProviders(['apple', 'google', 'github'])).toEqual(['github', 'apple']);
        expect(offeredProviders([])).toEqual([]);
    });
});
