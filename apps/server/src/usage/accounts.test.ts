import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderAccountsService } from '../providers/accounts/service.ts';
import { testAccounts } from '../providers/accounts/test-accounts.ts';
import { limitAccountsOf, sessionAccountsOf, usageAccountsOf, usageRootsOf } from './accounts.ts';

let root: string;
let home: string;
let service: ProviderAccountsService;

const nameOf = (kind: string): string => (kind === 'claude' ? 'Claude Code' : 'Codex');

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-usage-accounts-'));
    home = join(root, 'home');
    service = await testAccounts({
        ruimteHome: root,
        env: { HOME: home },
        accounts: {
            claude_work: { kind: 'claude', label: 'Work', color: 'blue', home: join(root, 'work') },
            claude_off: { kind: 'claude', label: 'Off', home: join(root, 'off'), enabled: false },
            codex_work: { kind: 'codex', label: 'Work', home: '~/.codex', shadowHome: join(root, 'codex_work') }
        },
        folders: new Set([join(root, 'work'), join(root, 'off'), join(home, '.codex'), join(root, 'codex_work')])
    });
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('the accounts of the usage page and the limits', () => {
    test('the page may filter by every account, the default one named after its CLI', () => {
        expect(usageAccountsOf(service, nameOf)).toEqual([
            { id: 'claude', kind: 'claude', label: 'Claude Code' },
            { id: 'codex', kind: 'codex', label: 'Codex' },
            { id: 'claude_work', kind: 'claude', label: 'Work', color: 'blue' },
            { id: 'claude_off', kind: 'claude', label: 'Off' },
            { id: 'codex_work', kind: 'codex', label: 'Work' }
        ]);
    });

    test('walks the transcripts of every account once, with the accounts that share a folder', () => {
        expect(usageRootsOf(service)).toEqual([
            { provider: 'claude', path: join(home, '.claude', 'projects'), accounts: ['claude'] },
            { provider: 'codex', path: join(home, '.codex', 'sessions'), accounts: ['codex', 'codex_work'] },
            { provider: 'claude', path: join(root, 'work', 'projects'), accounts: ['claude_work'] },
            { provider: 'claude', path: join(root, 'off', 'projects'), accounts: ['claude_off'] }
        ]);
    });

    test('reads the plan of every default account, and of another once it is on and signed in', async () => {
        const limits = limitAccountsOf(service, nameOf, { HOME: home });
        expect(limits.list().map((account) => account.id)).toEqual(['claude', 'codex']);
        await service.refresh();
        expect(limits.list().map((account) => account.id)).toEqual(['claude', 'codex', 'claude_work', 'codex_work']);
        expect(limits.envFor('claude', 'claude_work').CLAUDE_CONFIG_DIR).toBe(join(root, 'work'));
        expect(limits.lastUsedAt('claude_work')).toBeNull();
        service.launched('claude', 'claude_work');
        expect(limits.lastUsedAt('claude_work')).not.toBeNull();
    });

    test('knows which account ran a session of a chat or a terminal', () => {
        const known = sessionAccountsOf(
            [
                { provider: 'codex', agentSessionId: 't-1', account: 'codex_work' },
                { provider: 'codex', agentSessionId: 't-2' },
                { provider: 'codex', agentSessionId: null, account: 'codex_work' }
            ],
            [
                {
                    agent: { kind: 'codex', agentSessionId: 't-3', transcriptPath: null, status: 'idle', live: true, updatedAt: 0 },
                    launch: { kind: 'codex', account: 'codex_work' }
                }
            ]
        );
        expect([...known]).toEqual([
            ['codex\0t-1', 'codex_work'],
            ['codex\0t-2', 'codex'],
            ['codex\0t-3', 'codex_work']
        ]);
    });
});
