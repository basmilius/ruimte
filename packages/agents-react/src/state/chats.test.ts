import { describe, expect, test } from 'bun:test';
import type { ChatInfo, ChatItem } from '@ruimte/agent-contracts';
import { applyEvent, chatSink, prependPage, useChats, waitingRequestsOf, type ChatState } from './chats';

function info(patch: Partial<ChatInfo> = {}): ChatInfo {
    return {
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
    };
}

function user(id: string, text: string): ChatItem {
    return { id, kind: 'user', createdAt: 0, turnId: null, text };
}

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

    test('the first text of a reply and an item event change the structure', () => {
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

        expect(applyEvent(first, { type: 'item', item: { ...empty, text: 'Hi', streaming: false } }).structure).not.toBe(first.structure);
    });

    test("a stream of tool output and a sub-agent's words leaves the structure of a long thread as it was", () => {
        const thread: ChatItem[] = Array.from({ length: 5000 }, (_, i) => user(`u${i}`, `message ${i}`));
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
        const child: ChatItem = { id: 'c', kind: 'assistant', createdAt: 0, turnId: null, text: 'Reading', streaming: true, parentToolUseId: 'task-1' };
        const items = Object.fromEntries([...thread, tool, child].map((item) => [item.id, item]));
        const start: ChatState = { info: info(), items, structure: items, order: Object.keys(items) };

        let state = start;
        for (let i = 0; i < 500; i++) {
            state = applyEvent(state, { type: 'delta', itemId: 'x', text: `line ${i}\n` });
            state = applyEvent(state, { type: 'delta', itemId: 'c', text: '.' });
        }

        expect(state.structure).toBe(start.structure);
        expect(state.order).toBe(start.order);
        const grown = state.items.x;
        expect(grown?.kind === 'tool' ? grown.progress?.output?.split('\n').length : null).toBe(501);
        expect(state.items.c).toEqual({ ...child, text: `Reading${'.'.repeat(500)}` });
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
        const key = 'status-test/chat-1';
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

    test('hold a chat nobody attached to, and leave with the host', () => {
        const key = 'gone/chat-1';
        const other = 'kept/chat-1';
        useChats.getState().status(key, info({ status: 'running' }));
        useChats.getState().status(other, info({ status: 'running' }));
        expect(useChats.getState().statusByKey[key]?.info.status).toBe('running');
        useChats.getState().forgetWhere((candidate) => candidate.startsWith('gone/'));
        expect(useChats.getState().statusByKey[key]).toBeUndefined();
        expect(useChats.getState().byKey[key]).toBeUndefined();
        expect(useChats.getState().statusByKey[other]?.info.status).toBe('running');
        useChats.getState().forget(other);
    });

    test('a sink writes under the keys of its scope', () => {
        chatSink((chatId) => `sink/${chatId}`).status('chat-1', info({ status: 'idle' }));
        expect(useChats.getState().statusByKey['sink/chat-1']?.info.status).toBe('idle');
        useChats.getState().forget('sink/chat-1');
    });
});

describe('a thread held from its newest page', () => {
    const question = (id: string, state: 'pending' | 'answered'): ChatItem => ({
        id,
        kind: 'question',
        createdAt: 0,
        turnId: null,
        requestId: `request-${id}`,
        questions: [],
        answers: null,
        state
    });
    const key = 'paged/chat-1';
    const newest = [user('u3', 'third'), user('u4', 'fourth')];

    const held = (): ChatState => {
        useChats.getState().reset(key, info(), newest, { history: { start: 2, cursor: 'g:2' }, pending: [question('q0', 'pending')] });
        const state = useChats.getState().byKey[key]!;
        useChats.getState().forget(key);
        return state;
    };

    test('keeps where it starts, and a request from before it that still waits outside the thread', () => {
        const state = held();
        expect(state.order).toEqual(['u3', 'u4']);
        expect(state.history).toEqual({ start: 2, cursor: 'g:2' });
        expect(waitingRequestsOf(state).map((item) => item.id)).toEqual(['q0']);
    });

    test('an item from before the page is left out, unless it is a request that waits or stops waiting', () => {
        let state = held();
        state = applyEvent(state, { type: 'item', item: user('u1', 'edited'), historyIndex: 0 });
        expect(state.items.u1).toBeUndefined();

        state = applyEvent(state, { type: 'item', item: question('q0', 'answered'), historyIndex: 1 });
        expect(waitingRequestsOf(state)).toEqual([]);
        expect(state.order).toEqual(['u3', 'u4']);

        state = applyEvent(state, { type: 'item', item: user('u5', 'fifth'), historyIndex: 4 });
        expect(state.order).toEqual(['u3', 'u4', 'u5']);
    });

    test('the page before goes in above, and the last one makes the thread whole', () => {
        const page = { items: [user('u1', 'first'), question('q0', 'pending')], history: { start: 0, cursor: null } };
        const state = prependPage(held(), 'g:2', page);
        expect(state.order).toEqual(['u1', 'q0', 'u3', 'u4']);
        expect(state.history).toBeUndefined();
        expect(state.waitingBefore).toBeUndefined();
        expect(waitingRequestsOf(state).map((item) => item.id)).toEqual(['q0']);
    });

    test('a page for a cursor the thread no longer has changes nothing', () => {
        const state = held();
        expect(prependPage(state, 'g:9', { items: [user('u1', 'first')], history: { start: 0, cursor: null } })).toBe(state);
    });
});
