import { describe, expect, test } from 'bun:test';
import type { AgentKind } from '@ruimte/contracts';
import { providerFor } from '../registry.ts';
import { accountEnv, accountFolder, accountProblem, canContinue, readAccount, withDefaults } from './accounts.ts';

const env = { HOME: '/home/bas', PATH: '/bin', ANTHROPIC_API_KEY: 'sk-ant', CLAUDE_CODE_OAUTH_TOKEN: 'oat', OPENAI_API_KEY: 'sk-oai', CODEX_API_KEY: 'ck' };
const providerOf = (kind: AgentKind) => providerFor(kind);
const claude = providerFor('claude');
const codex = providerFor('codex');

describe('accountEnv', () => {
    test('leaves the environment of a default account exactly as it was', () => {
        expect(accountEnv('claude', { kind: 'claude' }, claude, env)).toBe(env);
    });

    test('points Claude Code at the folder and drops what would sign it in over that login', () => {
        const next = accountEnv('claude_personal', { kind: 'claude', home: '~/.claude_personal' }, claude, env);
        expect(next.CLAUDE_CONFIG_DIR).toBe('/home/bas/.claude_personal');
        expect(next.ANTHROPIC_API_KEY).toBeUndefined();
        expect(next.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
        expect(next.HOME).toBe('/home/bas');
        expect(next.OPENAI_API_KEY).toBe('sk-oai');
        expect(env.ANTHROPIC_API_KEY).toBe('sk-ant');
    });

    test('starts Codex in the shadow home when there is one', () => {
        const next = accountEnv('codex_personal', { kind: 'codex', home: '~/.codex', shadowHome: '~/.codex_personal' }, codex, env);
        expect(next.CODEX_HOME).toBe('/home/bas/.codex_personal');
        expect(next.OPENAI_API_KEY).toBeUndefined();
        expect(next.CODEX_API_KEY).toBeUndefined();
        expect(next.ANTHROPIC_API_KEY).toBe('sk-ant');
    });
});

describe('accountFolder', () => {
    test('the default account follows the variable the daemon itself was given', () => {
        expect(accountFolder('claude', { kind: 'claude' }, claude, env)).toBe('/home/bas/.claude');
        expect(accountFolder('codex', { kind: 'codex' }, codex, { ...env, CODEX_HOME: '/opt/codex' })).toBe('/opt/codex');
        expect(accountFolder('gemini', { kind: 'gemini' }, providerFor('gemini'), env)).toBe('');
    });
});

describe('accountProblem', () => {
    test('accepts a default account and a second one with a folder', () => {
        expect(accountProblem('claude', { kind: 'claude', label: 'Work' }, claude, env)).toBeNull();
        expect(accountProblem('claude_personal', { kind: 'claude', home: '~/.claude_personal' }, claude, env)).toBeNull();
    });

    test('refuses what cannot mean anything', () => {
        expect(accountProblem('claude', { kind: 'claude', home: '~/.other' }, claude, env)).not.toBeNull();
        expect(accountProblem('codex', { kind: 'claude', home: '~/.x' }, claude, env)).not.toBeNull();
        expect(accountProblem('claude_personal', { kind: 'claude' }, claude, env)).not.toBeNull();
        expect(accountProblem('claude_personal', { kind: 'claude', home: 'relative/folder' }, claude, env)).not.toBeNull();
        expect(accountProblem('claude_personal', { kind: 'claude', home: '~/.a', shadowHome: '~/.b' }, claude, env)).not.toBeNull();
        expect(accountProblem('codex_personal', { kind: 'codex', home: '~/.codex', shadowHome: '/home/bas/.codex' }, codex, env)).not.toBeNull();
    });

    test('lets a CLI without a folder variable keep a second account, which is then only unavailable', () => {
        expect(accountProblem('gemini_work', { kind: 'gemini' }, providerFor('gemini'), env)).toBeNull();
    });
});

describe('withDefaults', () => {
    test('always holds a default account per CLI, first and in catalog order', () => {
        const accounts = withDefaults({ claude_personal: { kind: 'claude', home: '~/.cp' }, codex: { kind: 'codex', label: 'Work' } });
        expect(Object.keys(accounts)).toEqual(['claude', 'codex', 'gemini', 'copilot', 'apple', 'claude_personal']);
        expect(accounts.codex).toEqual({ kind: 'codex', label: 'Work' });
    });
});

describe('readAccount', () => {
    test('keeps an unknown kind exactly as it was written', () => {
        const raw = { kind: 'cursor', home: '~/.cursor', future: { nested: true } };
        expect(readAccount('cursor_work', raw, providerOf, env)).toBe(raw);
    });

    test('drops an entry that does not parse or does not make sense', () => {
        expect(readAccount('claude_personal', { kind: 'claude', home: 42 }, providerOf, env)).toBeNull();
        expect(readAccount('claude_personal', { kind: 'claude' }, providerOf, env)).toBeNull();
        expect(readAccount('claude', { kind: 'cursor' }, providerOf, env)).toBeNull();
        expect(readAccount('x', 'claude', providerOf, env)).toBeNull();
    });
});

describe('canContinue', () => {
    test('two Codex accounts over one home continue each other, shadow home or not', () => {
        const work = { id: 'codex', account: { kind: 'codex' } };
        const personal = { id: 'codex_personal', account: { kind: 'codex', home: '~/.codex', shadowHome: '~/.codex_personal' } };
        const apart = { id: 'codex_apart', account: { kind: 'codex', home: '~/.codex_apart' } };
        expect(canContinue(work, personal, providerOf, env)).toBe(true);
        expect(canContinue(personal, apart, providerOf, env)).toBe(false);
    });

    test('two Claude folders never do, and neither do two CLIs', () => {
        const work = { id: 'claude', account: { kind: 'claude' } };
        const personal = { id: 'claude_personal', account: { kind: 'claude', home: '~/.claude_personal' } };
        expect(canContinue(work, personal, providerOf, env)).toBe(false);
        expect(canContinue(work, { id: 'codex', account: { kind: 'codex' } }, providerOf, env)).toBe(false);
        expect(canContinue(personal, personal, providerOf, env)).toBe(true);
    });
});
