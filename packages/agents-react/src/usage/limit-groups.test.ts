import { describe, expect, test } from 'bun:test';
import type { ProviderAccounts, ProviderAccountStatus, UsageLimitsProvider, UsageWindow } from '@ruimte/agent-contracts';
import { checkedLabel, hasSeveralAccounts, limitGroups, nextReset } from './limit-groups';

const status = (id: string, kind: string, state: ProviderAccountStatus['state'] = 'ready'): ProviderAccountStatus => ({
    id,
    kind,
    state,
    email: null,
    plan: null,
    organization: null,
    home: '',
    message: null,
    checkedAt: 1
});

const entry = (kind: 'claude' | 'codex', account?: { id: string; label: string }, extra: Partial<UsageLimitsProvider> = {}): UsageLimitsProvider => ({
    kind,
    ...(account === undefined ? {} : { account }),
    plan: null,
    checkedAt: 5,
    source: 'probe',
    windows: [],
    cost: null,
    unavailable: null,
    ...extra
});

const window = (id: string, resetsAt: number | null): UsageWindow => ({ id, kind: 'session', label: id, used: 0.2, resetsAt, durationMs: null });

describe('limits per account', () => {
    const accounts: ProviderAccounts = {
        accounts: {
            claude: { kind: 'claude' },
            claude_work: { kind: 'claude', label: 'Work', color: 'blue' },
            claude_out: { kind: 'claude', label: 'Out' },
            claude_off: { kind: 'claude', label: 'Off', enabled: false },
            codex: { kind: 'codex' }
        },
        statuses: [
            status('claude', 'claude'),
            status('claude_work', 'claude'),
            status('claude_out', 'claude', 'signed-out'),
            status('claude_off', 'claude', 'signed-out'),
            status('codex', 'codex')
        ]
    };

    test('a CLI lists what the machine read, then the accounts it does not read that are on', () => {
        const groups = limitGroups(
            { providers: [entry('claude', { id: 'claude', label: 'Claude Code' }), entry('claude', { id: 'claude_work', label: 'Old name' }), entry('codex')] },
            accounts
        );
        expect(groups.map((group) => [group.kind, group.accounts.map((account) => account.id)])).toEqual([
            ['claude', ['claude', 'claude_work', 'claude_out']],
            ['codex', ['codex']]
        ]);
        const work = groups[0]!.accounts[1]!;
        expect([work.name, work.color, work.status?.state]).toEqual(['Work', 'blue', 'ready']);
        const out = groups[0]!.accounts[2]!;
        expect([out.entry, out.status?.state]).toEqual([null, 'signed-out']);
        expect(hasSeveralAccounts(groups)).toBe(true);
    });

    test('a machine from before accounts has one row per CLI, named after it', () => {
        const groups = limitGroups({ providers: [entry('claude'), entry('codex')] }, null);
        expect(groups.map((group) => group.accounts.map((account) => account.name))).toEqual([['Claude Code'], ['Codex']]);
        expect(hasSeveralAccounts(groups)).toBe(false);
    });
});

describe('the next reset', () => {
    test('is the window that resets first from now', () => {
        expect(nextReset([window('weekly', 900), window('passed', 50), window('session', 300), window('none', null)], 100)?.id).toBe('session');
    });

    test('is nothing when no window names one ahead', () => {
        expect(nextReset([window('passed', 50), window('none', null)], 100)).toBeNull();
    });
});

describe('where the numbers came from', () => {
    test('a read says how long ago, a turn says so first', () => {
        expect(checkedLabel(entry('claude', undefined, { checkedAt: 1_000 }), 1_000 + 30_000)).toBe('now');
        expect(checkedLabel(entry('claude', undefined, { checkedAt: 1_000 }), 1_000 + 120_000)).toBe('2 min ago');
        expect(checkedLabel(entry('claude', undefined, { checkedAt: 1_000, source: 'event' }), 1_000)).toBe('From a turn · now');
    });

    test('an account never read has no time to tell', () => {
        expect(checkedLabel(entry('claude', undefined, { checkedAt: 0 }), 1_000)).toBeNull();
    });
});
