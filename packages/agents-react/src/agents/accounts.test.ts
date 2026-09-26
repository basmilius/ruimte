import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProviderAccounts, ProviderAccountStatus } from '@ruimte/agent-contracts';
import { chatHost, setChatHost, type ChatHost } from '../host';
import { accountName, accountStatusLine, accountsOfKind, canContinueOn, freeAccountColor, hasAccountChoice, mintAccountId, offeredAccounts } from './accounts';

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
    const before: ChatHost['accents'] = chatHost().accents;
    beforeAll(() => {
        const featured = ['blue', 'orange', 'lime', 'indigo', 'pink'];
        setChatHost({ accents: { all: [...featured, 'red'].map((id) => ({ id, color: '#000000' })), featured, label: (id) => id, current: () => 'blue' } });
    });
    afterAll(() => setChatHost({ accents: before }));

    test('gets an id from its name that no other account has', () => {
        expect(mintAccountId('claude', 'Work (EU)', new Set())).toBe('claude_work-eu');
        expect(mintAccountId('codex', 'Privé', new Set(['codex_prive']))).toBe('codex_prive-2');
        expect(mintAccountId('claude', '!!!', new Set())).toBe('claude_account');
    });

    test('wears a featured accent the others do not, counting one without a color as the app accent', () => {
        expect(freeAccountColor(accountsOfKind(accounts, 'claude'), 'orange')).toBe('lime');
        expect(freeAccountColor(accountsOfKind(accounts, 'codex'), 'blue')).toBe('orange');
    });

    test('an old color name that is no accent counts as the app accent', () => {
        const old: ProviderAccounts = { accounts: { claude: { kind: 'claude', color: 'gray' } }, statuses: [] };
        expect(freeAccountColor(accountsOfKind(old, 'claude'), 'blue')).toBe('orange');
    });
});

describe('a choice of account in a chat', () => {
    const three: ProviderAccounts = {
        accounts: {
            codex: { kind: 'codex' },
            codex_work: { kind: 'codex', home: '~/.codex', shadowHome: '~/.codex_work' },
            codex_off: { kind: 'codex', home: '~/.codex_off', enabled: false },
            claude: { kind: 'claude' }
        },
        statuses: [
            status('codex', { transcripts: '/home/codex' }),
            status('codex_work', { transcripts: '/home/codex' }),
            status('codex_off', { transcripts: '/home/codex_off' })
        ]
    };

    test('exists with two accounts that are on, and offers the one in use even while it is off', () => {
        const entries = accountsOfKind(three, 'codex');
        expect(hasAccountChoice(entries)).toBe(true);
        expect(hasAccountChoice(accountsOfKind(three, 'claude'))).toBe(false);
        expect(offeredAccounts(entries, 'codex').map((entry) => entry.id)).toEqual(['codex', 'codex_work']);
        expect(offeredAccounts(entries, 'codex_off').map((entry) => entry.id)).toEqual(['codex', 'codex_work', 'codex_off']);
    });

    test('goes on under an account that writes its conversations to the same folder, and under no other', () => {
        expect(canContinueOn(three, 'codex', undefined, 'codex_work')).toBe(true);
        expect(canContinueOn(three, 'codex', 'codex_work', 'codex')).toBe(true);
        expect(canContinueOn(three, 'codex', undefined, 'codex_off')).toBe(false);
        expect(canContinueOn(three, 'codex', undefined, undefined)).toBe(true);
        expect(canContinueOn(three, 'codex', undefined, 'codex_gone')).toBe(false);
    });

    test('a machine that does not say where an account writes answers no', () => {
        const quiet = { ...three, statuses: [status('codex'), status('codex_work')] };
        expect(canContinueOn(quiet, 'codex', undefined, 'codex_work')).toBe(false);
        expect(canContinueOn(null, 'codex', undefined, 'codex_work')).toBe(false);
    });
});
