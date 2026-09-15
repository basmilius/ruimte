import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { SUCCESS_MS } from '@/state/toasts';
import { confirmAccount, dismissAccountConfirmation, linkedConfirmation, signedInConfirmation, useAccountConfirmation } from './confirmation';

describe('confirming a sign-in', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        dismissAccountConfirmation();
    });

    afterEach(() => {
        dismissAccountConfirmation();
        jest.useRealTimers();
    });

    test('names the provider picked, with the login when the account has one', () => {
        expect(signedInConfirmation('apple', { id: 'a', provider: 'github', login: 'someone' })).toBe('Signed in with Apple as someone');
        expect(signedInConfirmation('apple', { id: 'a', provider: 'apple', login: null })).toBe('Signed in with Apple');
        expect(signedInConfirmation('github', { id: 'a', provider: 'github', login: 'someone' })).toBe('Signed in with GitHub as someone');
        expect(linkedConfirmation('github')).toBe('GitHub added to your account');
    });

    test('the line takes itself away after a while', () => {
        confirmAccount('Signed in with GitHub');
        jest.advanceTimersByTime(SUCCESS_MS - 1);
        expect(useAccountConfirmation.getState().text).toBe('Signed in with GitHub');
        jest.advanceTimersByTime(1);
        expect(useAccountConfirmation.getState().text).toBeNull();
    });

    test('a second line replaces the first and stays its full time', () => {
        confirmAccount('Signed in with GitHub');
        jest.advanceTimersByTime(SUCCESS_MS - 1);
        confirmAccount('Apple added to your account');
        jest.advanceTimersByTime(SUCCESS_MS - 1);
        expect(useAccountConfirmation.getState().text).toBe('Apple added to your account');
        jest.advanceTimersByTime(1);
        expect(useAccountConfirmation.getState().text).toBeNull();
    });

    test('dismissing takes it away at once, and no timer brings anything back', () => {
        confirmAccount('Signed in with GitHub');
        dismissAccountConfirmation();
        expect(useAccountConfirmation.getState().text).toBeNull();
        jest.advanceTimersByTime(SUCCESS_MS + 1);
        expect(useAccountConfirmation.getState().text).toBeNull();
    });
});
