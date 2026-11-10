import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { BookmarkStore } from '@adecore/agents/chat';
import type { ChatBookmark } from '@ruimte/contracts';
import type { SessionEvent } from '../wire.ts';
import { makeChatFixture, retire } from './chat-manager.fixture.test.ts';
import { INLINE_EDIT_PREAMBLE } from './inline-edit.ts';

type ChatFixture = Awaited<ReturnType<typeof makeChatFixture>>;
let home: ChatFixture['home'];
let store: ChatFixture['store'];
let manager: ChatFixture['manager'];
let recorder: ChatFixture['recorder'];
let remake: ChatFixture['remake'];
let open: ChatFixture['open'];
beforeEach(async () => {
    ({ home, store, manager, recorder, open, remake } = await makeChatFixture());
});
afterEach(async () => {
    await retire(manager);
    await rm(home, { recursive: true, force: true });
});

test('a UI block reads and links only for a client that holds the chat project', async () => {
    const holders = new Set<string>();
    manager = await remake(manager, { holdsProject: async (_chatId, clientId) => holders.has(clientId) });
    await open(manager, 'ui-gate');
    const query = { chatId: 'ui-gate', itemId: 'reply', blockId: 'block', revision: '1', query: 'status' };
    const link = { chatId: 'ui-gate', itemId: 'reply', blockId: 'block', revision: '1', nodeId: 'node' };
    await expect(manager.core.queryUi(query, 'c1')).rejects.toThrow("Open this chat's project");
    await expect(manager.core.linkUi(link, 'c1')).rejects.toThrow("Open this chat's project");
    holders.add('c1');
    // Past the gate, the chat core answers: this manager has no UI sources at all.
    await expect(manager.core.queryUi(query, 'c1')).rejects.toThrow('does not provide UI query sources');
});

test('a reply compiles UI blocks under the ruimte-ui fence that stored chats and agents use', async () => {
    await open(manager, 'ui-chat');
    await manager.core.send('ui-chat', 'Status\n```ruimte-ui\n<Summary>Ready</Summary>\n```');
    await recorder.untilIdle();
    const [reply] = recorder.ofKind('assistant');
    expect(reply?.ui).toHaveLength(1);
    expect(reply?.ui?.[0]?.complete).toBe(true);
});

describe('a chat an inline edit runs in', () => {
    beforeEach(async () => {
        manager = await remake(manager, { inlineChat: (chatId) => chatId === 'chat-inline' });
    });

    test('hears the answer format once in front of its first prompt, and none of it shows in the thread', async () => {
        await open(manager, 'chat-inline');
        await manager.core.send('chat-inline', 'make it shorter');
        await recorder.untilIdle();
        await manager.core.send('chat-inline', 'and rename it');
        await recorder.until(() => recorder.info?.usage.turns === 2 && recorder.idle);

        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual([`echo: ${INLINE_EDIT_PREAMBLE}\n\nmake it shorter`, 'echo: and rename it']);
        expect(recorder.ofKind('user').map((item) => item.text)).toEqual(['make it shorter', 'and rename it']);
        expect(recorder.ofKind('note')).toEqual([]);
    });

    test('says so again after the chat started over', async () => {
        await open(manager, 'chat-inline');
        await manager.core.send('chat-inline', 'first');
        await recorder.untilIdle();
        await manager.core.clear('chat-inline');
        await manager.core.send('chat-inline', 'second');
        await recorder.until(() => recorder.ofKind('assistant').some((item) => item.text.endsWith('second')));

        expect(recorder.ofKind('assistant').at(-1)?.text).toBe(`echo: ${INLINE_EDIT_PREAMBLE}\n\nsecond`);
    });

    test('is hidden in the list and no other chat is', async () => {
        const hidden = await manager.core.create({ chatId: 'chat-inline', cwd: home });
        const listed = await manager.core.create({ chatId: 'chat-plain', cwd: home });

        expect(hidden.hidden).toBe(true);
        expect(listed.hidden).toBeUndefined();
        expect(manager.core.list().map((info) => [info.chatId, info.hidden])).toEqual([
            ['chat-inline', true],
            ['chat-plain', undefined]
        ]);
    });

    test('is listed like any chat once its view is, and the record forgets it was hidden', async () => {
        await open(manager, 'chat-inline');
        await manager.core.send('chat-inline', 'first');
        await recorder.untilIdle();
        await store.written('chat-inline', (record) => record.info.hidden === true);

        manager = await remake(manager);
        const info = await manager.core.create({ chatId: 'chat-inline', cwd: home });

        expect(info.hidden).toBeUndefined();
    });
});

describe('bookmarks', () => {
    test('a bookmark goes to every client reading the chat, rides on the next attach and goes with a clear', async () => {
        manager = await remake(manager, { bookmarks: new BookmarkStore(home) });
        const heard: Array<{ clientId: string; bookmarks: ChatBookmark[] }> = [];
        for (const clientId of ['c2', 'c3']) {
            manager.core.subscribe(clientId, (event: SessionEvent) => {
                if (event.event === 'chat.bookmarks') {
                    heard.push({ clientId, bookmarks: event.payload.bookmarks });
                }
            });
        }
        await open(manager, 'chat-b');
        await manager.core.send('chat-b', 'hello  there');
        await recorder.untilIdle();
        manager.core.attach('chat-b', 'c2');

        const reply = recorder.ofKind('assistant')[0]!;
        const list = await manager.core.addBookmark('chat-b', reply.id, 'The answer');
        expect(list).toEqual([{ itemId: reply.id, name: 'The answer', excerpt: 'echo: hello there', createdAt: expect.any(Number) }]);
        // A client that is not reading the thread hears nothing and gets the list when it attaches.
        expect(heard).toEqual([{ clientId: 'c2', bookmarks: list }]);
        expect((await manager.core.attachWithBookmarks('chat-b', 'c3')).bookmarks).toEqual(list);

        const turn = recorder.ofKind('turn')[0]!;
        expect(() => manager.core.addBookmark('chat-b', turn.id)).toThrow('no message');

        await manager.core.clear('chat-b');
        expect(heard.slice(1)).toEqual([
            { clientId: 'c2', bookmarks: [] },
            { clientId: 'c3', bookmarks: [] }
        ]);
        expect((await manager.core.attachWithBookmarks('chat-b', 'c3')).bookmarks).toEqual([]);
    });
});
