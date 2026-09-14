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
    test('a delta grows the text of a thinking item as it does an assistant one', () => {
        const thinking: ChatItem = { id: 't', kind: 'thinking', createdAt: 0, turnId: null, text: 'Let me', streaming: true, endedAt: null };
        const state: ChatState = { info: info(), items: { t: thinking }, structure: { t: thinking }, order: ['t'] };

        const next = applyEvent(state, { type: 'delta', itemId: 't', text: ' think' });

        expect(next.items.t).toEqual({ ...thinking, text: 'Let me think' });
    });

    test('a delta on a reply with text leaves the structure the rows are derived from as it was', () => {
        const reply: ChatItem = { id: 'r', kind: 'assistant', createdAt: 0, turnId: null, text: 'Hello', streaming: true };
        const state: ChatState = { info: info(), items: { r: reply }, structure: { r: reply }, order: ['r'] };

        const next = applyEvent(state, { type: 'delta', itemId: 'r', text: ' there' });

        expect(next.structure).toBe(state.structure);
        expect(next.order).toBe(state.order);
        expect(next.items.r).toEqual({ ...reply, text: 'Hello there' });
    });

    test('the first text of a reply, an item event and tool output all change the structure', () => {
        const empty: ChatItem = { id: 'r', kind: 'assistant', createdAt: 0, turnId: null, text: '', streaming: false };
        const tool: ChatItem = {
            id: 'x',
            kind: 'tool',
            createdAt: 0,
            turnId: null,
            toolUseId: 'x',
            name: 'Bash',
            input: {},
            state: 'running',
            output: null,
            parentToolUseId: null
        };
        const state: ChatState = { info: info(), items: { r: empty, x: tool }, structure: { r: empty, x: tool }, order: ['r', 'x'] };

        const first = applyEvent(state, { type: 'delta', itemId: 'r', text: 'Hi' });
        expect(first.structure).not.toBe(state.structure);
        expect(first.structure.r).toEqual({ ...empty, text: 'Hi' });

        expect(applyEvent(first, { type: 'delta', itemId: 'x', text: 'out' }).structure).not.toBe(first.structure);
        expect(applyEvent(first, { type: 'item', item: { ...empty, text: 'Hi', streaming: false } }).structure).not.toBe(first.structure);
    });

    test('a reset replaces the items and their order along with the info', () => {
        const items = { a: user('a', 'old'), b: user('b', 'older') };
        const state: ChatState = { info: info(), items, structure: items, order: ['a', 'b'] };
        const cleared = info({
            agentSessionId: null,
            running: false,
            slashCommands: [],
            usage: { contextTokens: 0, contextWindow: 200000, costUsd: 0.5, turns: 3 }
        });

        expect(applyEvent(state, { type: 'reset', info: cleared, items: [] })).toEqual({ info: cleared, items: {}, structure: {}, order: [] });
        expect(applyEvent(state, { type: 'reset', info: cleared, items: [user('c', 'new')] })).toEqual({
            info: cleared,
            items: { c: user('c', 'new') },
            structure: { c: user('c', 'new') },
            order: ['c']
        });
    });
});
