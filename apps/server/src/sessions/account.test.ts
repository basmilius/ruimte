import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testAccounts } from '../providers/accounts/test-accounts.ts';
import { makeHarness, type Harness } from './test-helpers.ts';

let harness: Harness;

beforeEach(async () => {
    const home = await mkdtemp(join(tmpdir(), 'ruimte-account-'));
    const env = { PATH: '/usr/bin:/bin', HOME: home, ANTHROPIC_API_KEY: 'sk-inherited' };
    const accounts = await testAccounts({
        ruimteHome: home,
        env,
        accounts: {
            claude_personal: { kind: 'claude', label: 'Personal', home: '~/.claude_personal' },
            claude_gone: { kind: 'claude', label: 'Gone', home: '~/.claude_gone' }
        },
        folders: new Set([join(home, '.claude_personal')])
    });
    harness = await makeHarness({ env, accounts }, home);
});

afterEach(async () => {
    await harness.cleanup();
});

const create = (sessionId: string, account?: string) =>
    harness.manager.create({ sessionId, cols: 80, rows: 24, cwd: harness.home, agent: { kind: 'claude', ...(account ? { account } : {}) } });

describe('a terminal agent under an account', () => {
    test('leaves the shell as it was on the default account', async () => {
        await create('terminal-default');
        await create('terminal-named-default', 'claude');
        for (const id of ['terminal-default', 'terminal-named-default']) {
            const env = harness.adapter.forSession(id).options.env;
            expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
            expect(env.ANTHROPIC_API_KEY).toBe('sk-inherited');
        }
    });

    test('puts the folder on the shell and not on the typed line', async () => {
        await create('terminal-a', 'claude_personal');
        const pty = harness.adapter.forSession('terminal-a');
        expect(pty.options.env.CLAUDE_CONFIG_DIR).toBe(join(harness.home, '.claude_personal'));
        expect(pty.options.env.ANTHROPIC_API_KEY).toBeUndefined();
        expect(pty.typed).not.toContain('CLAUDE_CONFIG_DIR');
        expect(pty.typed.startsWith('claude ')).toBe(true);
    });

    test('refuses to start without its folder, and starts no shell under the default account', async () => {
        await expect(create('terminal-b', 'claude_gone')).rejects.toMatchObject({
            code: 'account-unavailable',
            message: "The account 'Gone' is not available on this machine: its folder ~/.claude_gone is missing."
        });
        await expect(create('terminal-c', 'nobody')).rejects.toMatchObject({ code: 'account-unavailable' });
        expect(harness.adapter.spawned.some((pty) => ['terminal-b', 'terminal-c'].includes(pty.options.env.RUIMTE_SESSION_ID ?? ''))).toBe(false);
    });
});
