import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AgentKind, ServerFrame } from '@ruimte/contracts';
import type { ProviderAccountsService } from '@adecore/agents/providers/accounts/service';
import { testAccounts } from '@adecore/agents/providers/accounts/test-accounts';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Dispatcher } from '../dispatcher.ts';
import { registerSessionHandlers, type LoginCommands } from '../handlers/session.ts';
import { makeHarness, type Harness } from './test-helpers.ts';

const LOGINS: LoginCommands = {
    commandOf: (kind: AgentKind) => ({ claude: 'claude auth login', codex: 'codex login' })[kind as 'claude' | 'codex'],
    nameOf: (kind: AgentKind) => ({ claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' })[kind as 'claude' | 'codex' | 'gemini'] ?? kind
};

let harness: Harness;
let accounts: ProviderAccountsService;
let dispatcher: Dispatcher;

beforeEach(async () => {
    const home = await mkdtemp(join(tmpdir(), 'ruimte-login-'));
    const env = { PATH: '/usr/bin:/bin', HOME: home };
    accounts = await testAccounts({
        home,
        env,
        accounts: { claude_work: { kind: 'claude', label: 'Work', home: '~/.claude_work' } },
        folders: new Set([join(home, '.claude_work')])
    });
    // A gate that refuses every command, as it does for a node no project places.
    harness = await makeHarness(
        { env, accounts, preferredAccount: () => 'claude_work', commands: { approved: () => false, approve: async () => undefined } },
        home
    );
    dispatcher = new Dispatcher();
    registerSessionHandlers(dispatcher, harness.manager, undefined, LOGINS);
});

afterEach(async () => {
    await harness.cleanup();
});

async function request(clientId: string, type: string, payload: unknown): Promise<ServerFrame> {
    const frames: ServerFrame[] = [];
    await dispatcher.handle({ id: clientId, send: (frame) => frames.push(frame) }, JSON.stringify({ id: 'request', type, payload }));
    return frames[0]!;
}

function login(clientId: string, sessionId: string, kind: AgentKind, account?: string): Promise<ServerFrame> {
    return request(clientId, 'session.login', { sessionId, kind, cols: 80, rows: 24, ...(account === undefined ? {} : { account }) });
}

describe('a login outside every project', () => {
    test('types the CLI login in the home folder at once, though no project approved it', async () => {
        expect(await login('desktop', 'login-1', 'claude')).toMatchObject({ ok: true, result: { sessionId: 'login-1', cwd: harness.home } });
        const pty = harness.adapter.forSession('login-1');
        expect(pty.typed).toBe('claude auth login\n');
        expect(pty.options.cwd).toBe(harness.home);
        expect(harness.manager.list()[0]?.heldCommand).toBeUndefined();
    });

    test('runs under the default account unless it names another, never the pick for new agents', async () => {
        await login('desktop', 'login-default', 'claude');
        await login('desktop', 'login-work', 'claude', 'claude_work');
        expect(harness.adapter.forSession('login-default').options.env.CLAUDE_CONFIG_DIR).toBeUndefined();
        expect(harness.adapter.forSession('login-work').options.env.CLAUDE_CONFIG_DIR).toBe(join(harness.home, '.claude_work'));
    });

    test('refuses a CLI without a login of its own and an account the machine does not have', async () => {
        expect(await login('desktop', 'login-gemini', 'gemini')).toMatchObject({ ok: false, error: { code: 'login-unavailable' } });
        expect(await login('desktop', 'login-gone', 'claude', 'claude_gone')).toMatchObject({ ok: false, error: { code: 'account-unavailable' } });
        expect(harness.manager.list()).toEqual([]);
    });

    test('ends when the client that asked for it leaves, and only then', async () => {
        await login('desktop', 'login-1', 'claude');
        await request('phone', 'session.attach', { sessionId: 'login-1', cols: 80, rows: 24 });
        harness.manager.detachAll('phone');
        expect(harness.manager.get('login-1')?.exited).toBe(false);
        harness.manager.detachAll('desktop');
        await harness.adapter.forSession('login-1').exited;
        expect(harness.manager.get('login-1')).toBeUndefined();
    });

    test('is named for Processes and leaves no screen on disk', async () => {
        await login('desktop', 'login-1', 'codex');
        harness.adapter.forSession('login-1').emit('Open this link to log in');
        expect(harness.manager.labelOf('login-1')).toBe('Codex login');
        expect(await harness.manager.snapshotAll()).toEqual([]);
    });
});
