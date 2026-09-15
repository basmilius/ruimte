import { afterEach, describe, expect, test } from 'bun:test';
import { confirmAccount, dismissAccountConfirmation, linkedConfirmation, signedInConfirmation, useAccountConfirmation } from './confirmation';

describe('confirming a sign-in', () => {
    afterEach(() => {
        dismissAccountConfirmation();
    });

    test('names the provider picked, with the login when the account has one', () => {
        expect(signedInConfirmation('apple', { id: 'a', provider: 'github', login: 'someone' })).toBe('Signed in with Apple as someone');
        expect(signedInConfirmation('apple', { id: 'a', provider: 'apple', login: null })).toBe('Signed in with Apple');
        expect(signedInConfirmation('github', { id: 'a', provider: 'github', login: 'someone' })).toBe('Signed in with GitHub as someone');
        expect(linkedConfirmation('github')).toBe('GitHub added to your account');
    });

    test('the line stays until it is dismissed, and a second one replaces the first', () => {
        confirmAccount('Signed in with GitHub');
        expect(useAccountConfirmation.getState().text).toBe('Signed in with GitHub');
        confirmAccount('Apple added to your account');
        expect(useAccountConfirmation.getState().text).toBe('Apple added to your account');
        dismissAccountConfirmation();
        expect(useAccountConfirmation.getState().text).toBeNull();
    });
});
