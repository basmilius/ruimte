import { describe, expect, test } from 'bun:test';
import type { ChatInfo, ChatItem } from '@ruimte/contracts';
import { applyEvent, useChats, type ChatState } from '@/state/chats';
import { endpointKey } from '@/state/keys';

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

describe('a status without an attach', () => {
    test('the first one opens a row with the thread still empty', () => {
        useChats.getState().status('local:chat-1', info({ status: 'needs-you' }));

        expect(useChats.getState().byKey['local:chat-1']).toEqual({
            info: info({ status: 'needs-you' }),
            items: {},
            structure: {},
            order: []
        });
    });

    test('a later one replaces the info and leaves the thread of an attached chat alone', () => {
        const items = { a: user('a', 'hello') };
        useChats.setState({ byKey: { 'local:chat-2': { info: info(), items, structure: items, order: ['a'] } } });

        useChats.getState().status('local:chat-2', info({ status: 'running' }));

        expect(useChats.getState().byKey['local:chat-2']).toEqual({
            info: info({ status: 'running' }),
            items,
            structure: items,
            order: ['a']
        });
    });

    test('the same info again changes nothing, so an attached thread is not redrawn for it', () => {
        useChats.setState({ byKey: { 'local:chat-3': { info: info(), items: {}, structure: {}, order: [] } } });
        const before = useChats.getState().byKey;

        useChats.getState().status('local:chat-3', info());

        expect(useChats.getState().byKey).toBe(before);
    });
});

describe('bookmarks in the store', () => {
    test('a reset of the thread keeps the bookmarks, which only their own list replaces', () => {
        const key = 'bookmarks-test:chat-1';
        const bookmark = { itemId: 'u1', excerpt: 'hi', createdAt: 1 };
        useChats.getState().reset(key, info(), [user('u1', 'hi')]);
        useChats.getState().bookmarks(key, [bookmark]);
        useChats.getState().reset(key, info(), [user('u1', 'hi'), user('u2', 'again')]);
        expect(useChats.getState().byKey[key]?.bookmarks).toEqual([bookmark]);
        useChats.getState().bookmarks(key, []);
        expect(useChats.getState().byKey[key]?.bookmarks).toEqual([]);
        useChats.getState().forget(key);
    });
});

describe('the statuses beside the threads', () => {
    test('stay the same object while a reply streams, and change with the info', () => {
        const key = endpointKey('status-test', 'chat-1');
        const reply: ChatItem = { id: 'r', kind: 'assistant', createdAt: 0, turnId: null, text: 'Hello', streaming: true };
        useChats.getState().reset(key, info({ status: 'running' }), [reply]);
        const streaming = useChats.getState().statusByKey;
        expect(streaming[key]?.info.status).toBe('running');

        useChats.getState().apply(key, { type: 'delta', itemId: 'r', text: ' there' });
        expect(useChats.getState().statusByKey).toBe(streaming);

        useChats.getState().apply(key, { type: 'info', info: info({ status: 'needs-you' }) });
        expect(useChats.getState().statusByKey[key]?.info.status).toBe('needs-you');

        useChats.getState().forget(key);
        expect(useChats.getState().statusByKey[key]).toBeUndefined();
    });

    test('hold a chat nobody attached to, and leave with the machine', () => {
        const key = endpointKey('gone', 'chat-1');
        useChats.getState().status(key, info({ status: 'running' }));
        expect(useChats.getState().statusByKey[key]?.info.status).toBe('running');
        useChats.getState().clear('gone');
        expect(useChats.getState().statusByKey[key]).toBeUndefined();
    });
});
