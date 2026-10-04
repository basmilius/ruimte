import { describe, expect, test } from 'bun:test';
import type { ProviderAccountStatus } from '@ruimte/contracts';
import { loginLanded } from './login-landing';

function status(patch: Partial<ProviderAccountStatus>): ProviderAccountStatus {
    return {
        id: 'claude',
        kind: 'claude',
        state: 'signed-out',
        email: null,
        plan: null,
        organization: null,
        home: '/Users/me/.claude',
        message: null,
        checkedAt: 1,
        ...patch
    };
}

describe('a login that lands', () => {
    test('lands once a signed-out account reads logged in, with a check in between or not', () => {
        const before = status({});
        expect(loginLanded(before, status({ state: 'checking', checkedAt: 2 }))).toBe(false);
        expect(loginLanded(before, status({ state: 'ready', email: 'me@example.com', checkedAt: 3 }))).toBe(true);
    });

    test('does not land on an account that was logged in already and reads the same', () => {
        const before = status({ state: 'ready', email: 'me@example.com' });
        expect(loginLanded(before, status({ state: 'ready', email: 'me@example.com', checkedAt: 9 }))).toBe(false);
        expect(loginLanded(before, status({ state: 'ready', email: 'other@example.com', checkedAt: 9 }))).toBe(true);
    });

    test('lands on the first reading when nothing was known before, and never on a failure', () => {
        expect(loginLanded(null, status({ state: 'ready' }))).toBe(true);
        expect(loginLanded(null, null)).toBe(false);
        expect(loginLanded(status({}), status({ state: 'failed', message: 'timeout' }))).toBe(false);
    });
});
