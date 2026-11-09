import { describe, expect, test } from 'bun:test';
import type { ChatItem } from '@ruimte/contracts';
import { namedAccount } from './agents.ts';
import type { AgentCall, CanvasHost } from './host.ts';

const user = (id: string, text: string, turnId: string | null): ChatItem => ({ id, kind: 'user', text, createdAt: 1, turnId }) as ChatItem;

const turn = (id: string, origin: 'user' | 'agent'): ChatItem =>
    ({ id, kind: 'turn', turnId: id, state: 'done', origin, createdAt: 1, endedAt: 2, costUsd: 0 }) as ChatItem;

function callWith(items: ChatItem[] | null, off: readonly string[] = []): AgentCall {
    const host = {
        starts: { accountOf: () => ({ kind: 'codex', account: 'codex_home' }), accountsOff: () => off },
        chatThreads: { items: async () => items, info: async () => null }
    } as unknown as CanvasHost;

    return { caller: 'chat-1', host };
}

describe('namedAccount', () => {
    const named = [turn('t1', 'user'), user('u1', 'Run it on @account:codex/codex_work.', 't1')];

    test('inherits the opener account as before when the call names none', async () => {
        expect(await namedAccount(callWith(named), 'codex', 'p1', null, null)).toBe('codex_home');
    });

    test('takes an account a person spelled in the chat, for the CLI it names', async () => {
        expect(await namedAccount(callWith(named), 'codex', 'p1', 'codex_work', null)).toBe('codex_work');
    });

    test('refuses an account only an agent turn spelled, or one no message spelled', async () => {
        const fromAgent = [turn('t1', 'agent'), user('u1', '@account:codex/codex_work', 't1')];

        await expect(namedAccount(callWith(fromAgent), 'codex', 'p1', 'codex_work', null)).rejects.toMatchObject({ code: 'account-not-named' });
        await expect(namedAccount(callWith(named), 'codex', 'p1', 'codex_other', null)).rejects.toMatchObject({ code: 'account-not-named' });
    });

    test('refuses for a terminal caller, which has no thread', async () => {
        await expect(namedAccount(callWith(null), 'codex', 'p1', 'codex_work', null)).rejects.toMatchObject({ code: 'account-not-named' });
    });

    test('refuses an account named for another CLI', async () => {
        await expect(namedAccount(callWith(named), 'claude', 'p1', 'codex_work', null)).rejects.toMatchObject({ code: 'account-other-cli' });
    });

    test('refuses an account the project turned off', async () => {
        await expect(namedAccount(callWith(named, ['codex_work']), 'codex', 'p1', 'codex_work', null)).rejects.toMatchObject({ code: 'account-off' });
    });

    test('refuses an account for an agent on another machine', async () => {
        await expect(namedAccount(callWith(named), 'codex', 'p1', 'codex_work', 'studio')).rejects.toMatchObject({ code: 'account-elsewhere' });
    });
});
