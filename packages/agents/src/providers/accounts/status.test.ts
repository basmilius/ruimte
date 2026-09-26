import { describe, expect, test } from 'bun:test';
import { readClaudeAuthStatus, readCodexAccount } from './status.ts';

describe('readClaudeAuthStatus', () => {
    test('reads who is signed in, as Claude Code 2.1.282 prints it', () => {
        const output = JSON.stringify({
            loggedIn: true,
            authMethod: 'claude.ai',
            apiProvider: 'firstParty',
            configDirectory: '/home/bas/.claude',
            email: 'bas@example.com',
            orgId: 'org-1',
            orgName: 'Example',
            subscriptionType: 'max'
        });
        expect(readClaudeAuthStatus(output)).toEqual({ signedIn: true, email: 'bas@example.com', plan: 'max', organization: 'Example' });
    });

    test('reads a fresh folder as signed out', () => {
        const output = JSON.stringify({ loggedIn: false, authMethod: 'none', configDirectory: '/home/bas/.claude_personal' });
        expect(readClaudeAuthStatus(output)).toEqual({ signedIn: false, email: null, plan: null, organization: null });
    });

    test('throws on anything else', () => {
        expect(() => readClaudeAuthStatus('Not logged in')).toThrow();
        expect(() => readClaudeAuthStatus('{}')).toThrow();
    });
});

describe('readCodexAccount', () => {
    test('reads a plan, a key and nobody, as Codex 0.157 answers them', () => {
        expect(readCodexAccount({ account: { type: 'chatgpt', email: 'bas@example.com', planType: 'pro' }, requiresOpenaiAuth: true })).toEqual({
            signedIn: true,
            email: 'bas@example.com',
            plan: 'pro',
            organization: null
        });
        expect(readCodexAccount({ account: { type: 'apiKey' }, requiresOpenaiAuth: true }).signedIn).toBe(true);
        expect(readCodexAccount({ account: null, requiresOpenaiAuth: true }).signedIn).toBe(false);
    });

    test('a model provider that needs no OpenAI login is signed in without an account', () => {
        expect(readCodexAccount({ account: null, requiresOpenaiAuth: false }).signedIn).toBe(true);
    });
});
