import { describe, expect, test } from 'bun:test';
import type { ProviderAccounts } from '@ruimte/contracts';
import { inlineEditAccountOn, inlineEditAgentFrom } from './ai-settings';

const accounts = {
    accounts: {
        claude: { kind: 'claude' },
        claude_work: { kind: 'claude', label: 'Work' },
        claude_off: { kind: 'claude', enabled: false },
        codex_alt: { kind: 'codex' }
    },
    statuses: []
} as unknown as ProviderAccounts;

describe('inlineEditAgentFrom', () => {
    test('reads the provider, the model and the account of a stored pick', () => {
        expect(inlineEditAgentFrom({ provider: 'claude', model: 'opus', account: 'claude_work' })).toEqual({
            provider: 'claude',
            model: 'opus',
            account: 'claude_work'
        });
    });

    test('leaves the account out when there is none, and falls back to the default for what makes no sense', () => {
        expect(inlineEditAgentFrom({ provider: 'claude', model: '', account: '' })).toEqual({ provider: 'claude', model: null });
        expect(inlineEditAgentFrom({ provider: 'nope', model: 4, account: 7 })).toEqual({ provider: 'claude', model: null });
        expect(inlineEditAgentFrom(null)).toEqual({ provider: 'claude', model: null });
    });
});

describe('inlineEditAccountOn', () => {
    test('keeps an account the machine has, turned on and of the same CLI', () => {
        expect(inlineEditAccountOn(accounts, 'claude', 'claude_work')).toBe('claude_work');
    });

    test('is the default account for one the machine lost, turned off, or that belongs to another CLI', () => {
        expect(inlineEditAccountOn(accounts, 'claude', 'claude_gone')).toBeUndefined();
        expect(inlineEditAccountOn(accounts, 'claude', 'claude_off')).toBeUndefined();
        expect(inlineEditAccountOn(accounts, 'claude', 'codex_alt')).toBeUndefined();
        expect(inlineEditAccountOn(accounts, 'claude', undefined)).toBeUndefined();
    });

    test('is the default account while the machine has not answered', () => {
        expect(inlineEditAccountOn(null, 'claude', 'claude_work')).toBeUndefined();
        expect(inlineEditAccountOn(undefined, 'claude', 'claude_work')).toBeUndefined();
    });
});
