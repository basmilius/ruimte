import { describe, expect, test } from 'bun:test';
import type { ProviderAccounts, ProviderAccountStatus } from '@ruimte/contracts';
import { accountName, accountStatusLine, accountsOfKind, freeAccountColor, mintAccountId } from './accounts';

const status = (id: string, patch: Partial<ProviderAccountStatus> = {}): ProviderAccountStatus => ({
    id,
    kind: id.split('_')[0]!,
    state: 'ready',
    email: null,
    plan: null,
    organization: null,
    home: `/home/${id}`,
    message: null,
    checkedAt: 1,
    ...patch
});

const accounts: ProviderAccounts = {
    accounts: {
        claude_work: { kind: 'claude', label: 'Work', color: 'blue', home: '~/.claude-work' },
        codex: { kind: 'codex' },
        claude: { kind: 'claude' }
    },
    statuses: [status('claude', { plan: 'Max' }), status('claude_work', { state: 'signed-out' })]
};

describe('the accounts of a CLI', () => {
    test('the default one first, then the others, each with what its CLI said', () => {
        const entries = accountsOfKind(accounts, 'claude');
        expect(entries.map((entry) => [entry.id, entry.isDefault, entry.status?.state])).toEqual([
            ['claude', true, 'ready'],
            ['claude_work', false, 'signed-out']
        ]);
        expect(accountsOfKind(null, 'claude')).toEqual([]);
    });

    test('a default account nobody named goes by its CLI', () => {
        const [own, work] = accountsOfKind(accounts, 'claude');
        expect(accountName(own!, 'Claude Code')).toBe('Claude Code');
        expect(accountName(work!, 'Claude Code')).toBe('Work');
    });
});

describe('the status line', () => {
    test('a login with a plan, one that is missing, and one that could not be checked', () => {
        expect(accountStatusLine(status('claude', { plan: 'Max' }), true)).toEqual({ text: 'Logged in · Max', tone: 'muted' });
        expect(accountStatusLine(status('claude', { state: 'signed-out' }), true)).toEqual({ text: 'Not logged in', tone: 'needs-you' });
        expect(accountStatusLine(status('claude', { state: 'failed' }), true).tone).toBe('error');
        expect(accountStatusLine(null, true).text).toBe('Checking');
    });

    test('a CLI without a folder of its own has no login to report', () => {
        expect(accountStatusLine(status('gemini'), false).text).toBe('Ready');
    });
});

describe('a new account', () => {
    test('gets an id from its name that no other account has', () => {
        expect(mintAccountId('claude', 'Work (EU)', new Set())).toBe('claude_work-eu');
        expect(mintAccountId('codex', 'Privé', new Set(['codex_prive']))).toBe('codex_prive-2');
        expect(mintAccountId('claude', '!!!', new Set())).toBe('claude_account');
    });

    test('wears a color the others do not', () => {
        expect(freeAccountColor(accountsOfKind(accounts, 'claude'))).toBe('purple');
    });
});
