import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderAccountsService } from '../providers/accounts/service.ts';
import { testAccounts } from '../providers/accounts/test-accounts.ts';
import { makeHarness, type Harness } from './test-helpers.ts';

let harness: Harness;
let preferred: string | undefined;
let accounts: ProviderAccountsService;
let env: Record<string, string>;

beforeEach(async () => {
    preferred = undefined;
    const home = await mkdtemp(join(tmpdir(), 'ruimte-account-'));
    env = { PATH: '/usr/bin:/bin', HOME: home, ANTHROPIC_API_KEY: 'sk-inherited' };
    accounts = await testAccounts({
        ruimteHome: home,
        env,
        accounts: {
            claude_personal: { kind: 'claude', label: 'Personal', home: '~/.claude_personal' },
            claude_gone: { kind: 'claude', label: 'Gone', home: '~/.claude_gone' }
        },
        folders: new Set([join(home, '.claude_personal')])
    });
    harness = await makeHarness({ env, accounts, preferredAccount: () => preferred }, home);
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

describe('a terminal agent that names no account', () => {
    test('starts under the account a person picked for new agents', async () => {
        preferred = 'claude_personal';
        await create('terminal-picked');
        expect(harness.adapter.forSession('terminal-picked').options.env.CLAUDE_CONFIG_DIR).toBe(join(harness.home, '.claude_personal'));
        expect(harness.manager.get('terminal-picked')!.launch).toMatchObject({ account: 'claude_personal' });
        await create('terminal-named', 'claude');
        expect(harness.adapter.forSession('terminal-named').options.env.CLAUDE_CONFIG_DIR).toBeUndefined();
    });

    test('is refused when the account it picked went, and never falls back on the default one', async () => {
        preferred = 'claude_gone';
        await expect(create('terminal-gone')).rejects.toMatchObject({ code: 'account-unavailable' });
    });

    test('keeps the account its CLI ran under after a restart, whatever the pick is by then', async () => {
        preferred = 'claude_personal';
        await create('terminal-a');
        const token = harness.manager.get('terminal-a')!.hookToken;
        await harness.manager.applyHook('claude', token, { session_id: 'claude-1', transcript_path: null, hook_event_name: 'SessionStart' });
        await harness.agents.settled();
        expect(await harness.agents.readRecord('terminal-a')).toMatchObject({ account: 'claude_personal' });

        preferred = undefined;
        const home = harness.home;
        harness.manager.killAll();
        const restarted = await makeHarness({ env, accounts, preferredAccount: () => preferred }, home);
        await restarted.manager.create({ sessionId: 'terminal-a', cols: 80, rows: 24, cwd: home, agent: { kind: 'claude' } });
        expect(restarted.adapter.forSession('terminal-a').options.env.CLAUDE_CONFIG_DIR).toBe(join(home, '.claude_personal'));
        restarted.manager.killAll();
    });
});
