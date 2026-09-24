import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatEvent, ChatInfo, ChatItem } from '@ruimte/contracts';
import { ChatLog } from './chat-log.ts';
import { ChatStore } from './chat-store.ts';

const info = (patch: Partial<ChatInfo> = {}): ChatInfo => ({
    chatId: 'chat',
    provider: 'claude',
    cwd: '/',
    agentSessionId: null,
    model: null,
    selection: { model: 'claude-sonnet-5', options: {} },
    runtimeMode: 'full-access',
    status: 'idle',
    running: false,
    activeTurnId: null,
    slashCommands: [],
    usage: { contextTokens: 0, contextWindow: null, costUsd: 0, turns: 0 },
    createdAt: 0,
    ...patch
});

const user = (id: string, text: string): ChatItem => ({ id, kind: 'user', createdAt: 1, turnId: null, text });
const assistant = (id: string, text: string): ChatItem => ({ id, kind: 'assistant', createdAt: 1, turnId: null, text, streaming: true });

let home: string;
let store: ChatStore;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-chat-store-'));
    store = new ChatStore(home);
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

const logEvents = (events: ChatEvent[], from = 0): ChatLog => {
    const log = new ChatLog(store.logPath('chat'), { seq: from, resetSeq: 0, lines: [] });
    for (const event of events) {
        log.append(event, 1);
    }
    log.close();
    return log;
};

describe('ChatStore', () => {
    test('plays the log over the snapshot from the seq the snapshot holds', async () => {
        const log = logEvents([
            { type: 'item', item: user('u1', 'hi') },
            { type: 'item', item: assistant('a1', 'he') }
        ]);
        await store.write('chat', info(), [user('u1', 'hi'), assistant('a1', 'he')], { seq: log.seq, resetSeq: 0 });
        // Written after the snapshot and before the next one: only the log has these.
        const late = new ChatLog(store.logPath('chat'), { seq: 2, resetSeq: 0, lines: [] });
        late.append({ type: 'delta', itemId: 'a1', text: 'llo' }, 1);
        late.append({ type: 'info', info: info({ status: 'running' }) }, 1);
        late.close();

        const record = await store.read('chat');
        expect(record?.seq).toBe(2);
        expect(record?.items.map((item) => (item.kind === 'assistant' || item.kind === 'user' ? item.text : ''))).toEqual(['hi', 'hello']);
        expect(record?.info.status).toBe('running');
        expect(record?.lines.map((line) => line.seq)).toEqual([1, 2, 3, 4]);
    });

    test('a torn last line loads without it', async () => {
        await store.write('chat', info(), [assistant('a1', 'he')], { seq: 0, resetSeq: 0 });
        logEvents([{ type: 'delta', itemId: 'a1', text: 'llo' }]);
        await appendFile(store.logPath('chat'), '{"seq":2,"at":1,"event":{"type":"delta","itemId":"a1","te');
        const record = await store.read('chat');
        expect(record?.items).toEqual([assistant('a1', 'hello')]);
        expect(record?.lines).toHaveLength(1);
    });

    test('knows a chat by its record or its log alone', async () => {
        expect(await store.has('chat')).toBe(false);
        logEvents([{ type: 'item', item: user('u1', 'hi') }]);
        expect(await store.has('chat')).toBe(true);
        await rm(store.logPath('chat'));
        await store.write('chat', info(), [user('u1', 'hi')]);
        expect(await store.has('chat')).toBe(true);
        await store.delete('chat');
        expect(await store.has('chat')).toBe(false);
    });

    test('a reset in the log empties the thread and says where it happened', async () => {
        await store.write('chat', info(), [user('u1', 'old')], { seq: 3, resetSeq: 0 });
        logEvents(
            [
                { type: 'reset', info: info(), items: [] },
                { type: 'item', item: user('u2', 'new') }
            ],
            3
        );
        const record = await store.read('chat');
        expect(record?.items).toEqual([user('u2', 'new')]);
        expect(record?.resetSeq).toBe(4);
    });

    test('a chat whose first snapshot never landed is rebuilt from a log that starts at the beginning', async () => {
        logEvents([
            { type: 'item', item: user('u1', 'hi') },
            { type: 'info', info: info({ status: 'running' }) }
        ]);
        const record = await store.read('chat');
        expect(record).toMatchObject({ items: [user('u1', 'hi')], info: { status: 'running' }, seq: 0 });
        expect(await store.list()).toEqual(['chat']);

        await rm(store.logPath('chat'));
        logEvents([{ type: 'item', item: user('u1', 'hi') }]);
        expect(await store.read('chat')).toBeNull();
        expect(await store.discardLog('chat')).toBe(1);
        expect(await store.list()).toEqual([]);
    });
});
