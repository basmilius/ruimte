import { describe, expect, test } from 'bun:test';
import type { ProviderAccounts, ProviderAccountStatus, UsageLimitsProvider, UsageLimitsSnapshot } from '@ruimte/contracts';
import { continueTarget, hasUnreadAccount, limitsOfAccount } from './account-limits';

const status = (id: string, state: ProviderAccountStatus['state'] = 'ready'): ProviderAccountStatus => ({
    id,
    kind: 'claude',
    state,
    email: null,
    plan: null,
    organization: null,
    home: '',
    message: null,
    checkedAt: 1
});

const accounts: ProviderAccounts = {
    accounts: {
        claude: { kind: 'claude' },
        claude_work: { kind: 'claude', label: 'Work' },
        claude_home: { kind: 'claude', label: 'Home' },
        claude_off: { kind: 'claude', enabled: false },
        claude_out: { kind: 'claude' }
    },
    statuses: [status('claude'), status('claude_work'), status('claude_home'), status('claude_off'), status('claude_out', 'signed-out')]
};

const limits = (id: string | null, session: number, weekly = 0.1, checkedAt = 5): UsageLimitsProvider => ({
    kind: 'claude',
    ...(id === null ? {} : { account: { id, label: id } }),
    plan: 'max',
    checkedAt,
    source: 'probe',
    windows: [
        { id: 'session', kind: 'session', label: 'Session', used: session, resetsAt: null, durationMs: null },
        { id: 'weekly', kind: 'weekly', label: 'Weekly', used: weekly, resetsAt: null, durationMs: null }
    ],
    cost: null,
    unavailable: null
});

const snapshot = (...providers: UsageLimitsProvider[]): UsageLimitsSnapshot => ({ providers });

describe('going on under another account after a limit', () => {
    test('picks the account with the least of its session spent', () => {
        const read = snapshot(limits(null, 1), limits('claude_work', 0.6), limits('claude_home', 0.2));
        expect(continueTarget(accounts, read, 'claude', undefined)?.id).toBe('claude_home');
        expect(continueTarget(accounts, read, 'claude', 'claude_home')?.id).toBe('claude_work');
    });

    test('never one that is off, signed out, spent on any window, or not read yet', () => {
        const read = snapshot(
            limits(null, 1),
            limits('claude_work', 0.2, 1),
            limits('claude_home', 0.1, 0.1, 0),
            limits('claude_off', 0),
            limits('claude_out', 0)
        );
        expect(continueTarget(accounts, read, 'claude', undefined)).toBeNull();
        expect(continueTarget(accounts, null, 'claude', undefined)).toBeNull();
    });

    test('knows which accounts still need a read', () => {
        expect(hasUnreadAccount(accounts, snapshot(limits(null, 1), limits('claude_work', 0.2), limits('claude_home', 0.2, 0, 0)), 'claude', undefined)).toBe(
            true
        );
        expect(hasUnreadAccount(accounts, snapshot(limits(null, 1), limits('claude_work', 0.2), limits('claude_home', 0.2)), 'claude', undefined)).toBe(false);
    });

    test('an entry from a machine before accounts is the default account', () => {
        expect(limitsOfAccount(snapshot(limits(null, 0.5)), 'claude')?.windows[0]?.used).toBe(0.5);
    });
});
