import { expect, test } from 'bun:test';
import { sessionAccountsOf } from './session-accounts.ts';

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
