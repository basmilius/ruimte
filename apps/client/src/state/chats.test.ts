import { describe, expect, test } from 'bun:test';
import type { ChatInfo, ChatItem } from '@ruimte/contracts';
import { applyEvent, type ChatState } from '@/state/chats';

const info = (patch: Partial<ChatInfo> = {}): ChatInfo => ({
    chatId: 'chat-1',
    provider: 'claude',
    cwd: '/',
    agentSessionId: 'session-1',
    model: null,
    selection: { model: 'claude-sonnet-5', options: {} },
    runtimeMode: 'full-access',
    status: 'idle',
    running: true,
    activeTurnId: null,
    slashCommands: ['compact'],
    usage: { contextTokens: 1200, contextWindow: 200000, costUsd: 0.5, turns: 3 },
    createdAt: 0,
    ...patch
});

const user = (id: string, text: string): ChatItem => ({ id, kind: 'user', createdAt: 0, turnId: null, text });

describe('applyEvent', () => {
    test('a reset replaces the items and their order along with the info', () => {
        const state: ChatState = { info: info(), items: { a: user('a', 'old'), b: user('b', 'older') }, order: ['a', 'b'] };
        const cleared = info({
            agentSessionId: null,
            running: false,
            slashCommands: [],
            usage: { contextTokens: 0, contextWindow: 200000, costUsd: 0.5, turns: 3 }
        });

        expect(applyEvent(state, { type: 'reset', info: cleared, items: [] })).toEqual({ info: cleared, items: {}, order: [] });
        expect(applyEvent(state, { type: 'reset', info: cleared, items: [user('c', 'new')] })).toEqual({
            info: cleared,
            items: { c: user('c', 'new') },
            order: ['c']
        });
    });
});
