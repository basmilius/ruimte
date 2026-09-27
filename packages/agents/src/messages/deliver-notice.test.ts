import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatTurnItem } from '@ruimte/agent-contracts';
import type { ChatSession } from '../chat/chat-session.ts';
import { chatNoticeTargets, deliverToChat, showNotices, turnFromMessage, type ChatNoticeTargets, type NoticeChat } from './deliver-notice.ts';
import { NoticeStore, type Notice } from './notice-store.ts';

let dataDir: string;
let store: NoticeStore;

const left = (text: string, targetId = 'chat-2'): Omit<Notice, 'createdAt'> => ({
    projectId: 'project-1',
    targetId,
    from: 'chat-1',
    fromTitle: 'Lead',
    text
});

const words = { shown: (notice: Notice): string => `${notice.fromTitle} wrote: ${notice.text}` };

const turn = (id: string, messageFrom?: string[]): ChatTurnItem => ({
    id,
    kind: 'turn',
    createdAt: 1,
    turnId: id,
    state: 'running',
    origin: 'agent',
    endedAt: null,
    costUsd: 0,
    ...(messageFrom ? { messageFrom } : {})
});

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'agents-deliver-'));
    store = new NoticeStore(dataDir);
});

afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
});

describe('deliverToChat', () => {
    const targets = (overrides: Partial<ChatNoticeTargets> = {}): ChatNoticeTargets => ({
        chat: async () => 'none',
        fromMessage: () => false,
        ...overrides
    });

    test('a chat between turns is owed one, and the message waits for it in the queue', async () => {
        expect(await deliverToChat(store, targets({ chat: async () => 'idle' }), left('the build is green'))).toEqual({ outcome: 'wake', waiting: 1 });
        // The turn's preamble is what takes it.
        expect(store.waiting('chat-2')).toHaveLength(1);
    });

    test('a chat in a turn keeps it, and a node that runs nothing waits to start', async () => {
        expect(await deliverToChat(store, targets({ chat: async () => 'running' }), left('the build is green'))).toEqual({ outcome: 'in-turn', waiting: 1 });
        expect(await deliverToChat(store, targets(), left('and another', 'chat-3'))).toEqual({ outcome: 'no-chat', waiting: 1 });
    });

    test('a sender in a turn a message started wakes nobody', async () => {
        const delivery = await deliverToChat(store, targets({ chat: async () => 'idle', fromMessage: (id) => id === 'chat-1' }), left('and the tests'));
        expect(delivery).toEqual({ outcome: 'from-message', waiting: 1 });
        expect(store.waiting('chat-2')).toHaveLength(1);
    });
});

describe('turnFromMessage', () => {
    test('only a running turn that names senders was opened by a message', () => {
        expect(turnFromMessage([turn('t1', ['chat-1'])], 't1')).toBe(true);
        expect(turnFromMessage([turn('t1', [])], 't1')).toBe(false);
        expect(turnFromMessage([turn('t1')], 't1')).toBe(false);
        expect(turnFromMessage([turn('t1', ['chat-1'])], null)).toBe(false);
    });
});

describe('chatNoticeTargets', () => {
    const session = (activeTurnId: string | null, items: ChatTurnItem[] = []): ChatSession =>
        ({ info: { activeTurnId }, thread: { list: () => items } }) as unknown as ChatSession;

    test('reads a chat as idle, running or absent, and one nobody loaded as idle', async () => {
        const held = new Map([
            ['chat-idle', session(null)],
            ['chat-busy', session('t1', [turn('t1')])]
        ]);
        const targets = chatNoticeTargets({ get: (id) => held.get(id), hasStored: async (id) => id === 'chat-cold' });
        expect(await targets.chat('chat-idle')).toBe('idle');
        expect(await targets.chat('chat-busy')).toBe('running');
        expect(await targets.chat('chat-cold')).toBe('idle');
        expect(await targets.chat('chat-none')).toBe('none');
    });

    test('knows a sender whose turn a message opened', () => {
        const held = new Map([
            ['chat-woken', session('t1', [turn('t1', ['chat-1'])])],
            ['chat-asked', session('t2', [turn('t2')])]
        ]);
        const targets = chatNoticeTargets({ get: (id) => held.get(id), hasStored: async () => false });
        expect(targets.fromMessage('chat-woken')).toBe(true);
        expect(targets.fromMessage('chat-asked')).toBe(false);
        expect(targets.fromMessage('chat-none')).toBe(false);
    });
});

describe('showNotices', () => {
    const chat = (has: boolean, lines: string[]): NoticeChat => ({
        has: () => Promise.resolve(has),
        note: (_id, text) => {
            lines.push(text);
            return Promise.resolve();
        }
    });

    test('puts everything waiting for a chat in its thread, once', async () => {
        const lines: string[] = [];
        await store.put(left('the build is green'));
        await store.put(left('and the tests'));
        await showNotices(store, chat(true, lines), words, 'chat-2');
        await showNotices(store, chat(true, lines), words, 'chat-2');
        expect(lines).toEqual(['Lead wrote: the build is green', 'Lead wrote: and the tests']);
    });

    test('an id no chat holds keeps its messages unshown, for the chat that opens on it later', async () => {
        const lines: string[] = [];
        await store.put(left('read the plan', 'chat-3'));
        await showNotices(store, chat(false, lines), words, 'chat-3');
        expect(lines).toEqual([]);
        await showNotices(store, chat(true, lines), words, 'chat-3');
        expect(lines).toEqual(['Lead wrote: read the plan']);
    });
});
