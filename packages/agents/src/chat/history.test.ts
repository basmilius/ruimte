import { describe, expect, test } from 'bun:test';
import type { ChatInfo, ChatItem } from '@ruimte/agent-contracts';
import { ChatThread } from './thread.ts';

const info = { chatId: 'history' } as ChatInfo;
const message = (i: number, text = `Message ${i}`): ChatItem => ({ id: `m${i}`, kind: 'assistant', text, streaming: false }) as ChatItem;

describe('chat history', () => {
    test('pages a large synthetic thread without dropping or repeating items', () => {
        const items = Array.from({ length: 2871 }, (_, i) => message(i, 'output '.repeat(900)));
        const thread = new ChatThread(info, items);
        let page = thread.history();
        const firstBytes = Buffer.byteLength(JSON.stringify(page));
        expect(firstBytes).toBeLessThan(512 * 1024);
        expect(page.items.length).toBe(60);
        let all = page.items;
        let requests = 1;
        while (page.history.cursor) {
            page = thread.history(60, page.history.cursor);
            all = [...page.items, ...all];
            requests++;
        }
        expect(all).toEqual(items);
        expect(requests).toBe(48);
        console.info(`Synthetic history: ${Buffer.byteLength(JSON.stringify(items))} bytes full, ${firstBytes} bytes first page, ${requests} pages`);
    });

    test('byte budget splits pages and never truncates an atomic item', () => {
        const large = message(1, 'x'.repeat(600_000));
        const thread = new ChatThread(info, [message(0), large, message(2)]);
        const page = thread.history();
        expect(page.items).toEqual([message(2)]);
        const older = thread.history(60, page.history.cursor!);
        expect(older.items).toEqual([large]);
        expect(thread.history(60, older.history.cursor!).items).toEqual([message(0)]);
    });

    test('appends preserve cursors, changes are read fresh, and reset invalidates cursors', () => {
        const thread = new ChatThread(info, [message(0), message(1), message(2)]);
        const page = thread.history(1);
        thread.upsert(message(3));
        thread.upsert(message(1, 'changed'));
        expect(thread.history(2, page.history.cursor!).items).toEqual([message(0), message(1, 'changed')]);
        thread.reset({});
        thread.upsert(message(0));
        expect(() => thread.history(2, page.history.cursor!)).toThrow('conversation changed');
    });

    test('pending requests are available outside the page and item indices remain stable', () => {
        const approval = { id: 'a', kind: 'approval', decision: 'pending', requestId: 'r' } as ChatItem;
        const thread = new ChatThread(info, [approval, message(0), message(1)]);
        expect(thread.history(1).items).toEqual([message(1)]);
        expect(thread.pending() as ChatItem[]).toEqual([approval]);
        expect(thread.upsert({ ...approval, decision: 'allow' } as ChatItem)).toMatchObject({ historyIndex: 0 });
        expect(thread.pending()).toEqual([]);
        expect(thread.upsert(message(2))).toMatchObject({ historyIndex: 3 });
    });
});
