import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatBookmark } from '@ruimte/agent-contracts';
import { BookmarkStore, bookmarkFileName } from './bookmark-store.ts';

let home: string;
let store: BookmarkStore;
let told: Array<{ chatId: string; bookmarks: ChatBookmark[] }>;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-bookmarks-'));
    store = new BookmarkStore(home);
    told = [];
    store.listen((chatId, bookmarks) => told.push({ chatId, bookmarks }));
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe('BookmarkStore', () => {
    test('a bookmark is kept on disk, named with a trimmed name, and a new store reads it back', async () => {
        await store.add('chat-1', { itemId: 'a', excerpt: 'Use the groups from sidebar-groups.ts' }, 10);
        await store.add('chat-1', { itemId: 'b', excerpt: 'Run bun test', name: '  Working command  ' }, 20);
        const again = new BookmarkStore(home);
        expect(await again.read('chat-1')).toEqual([
            { itemId: 'a', excerpt: 'Use the groups from sidebar-groups.ts', createdAt: 10 },
            { itemId: 'b', excerpt: 'Run bun test', name: 'Working command', createdAt: 20 }
        ]);
        expect(await again.read('chat-2')).toEqual([]);
    });

    test('marking a message twice keeps one bookmark, and only a name changes it', async () => {
        await store.add('chat-1', { itemId: 'a', excerpt: 'x' }, 10);
        await store.add('chat-1', { itemId: 'a', excerpt: 'x' }, 11);
        expect(told).toHaveLength(1);
        const named = await store.add('chat-1', { itemId: 'a', excerpt: 'x', name: 'Decision' }, 12);
        expect(named).toEqual([{ itemId: 'a', excerpt: 'x', name: 'Decision', createdAt: 10 }]);
        expect(told).toHaveLength(2);
    });

    test('a rename to nothing takes the name away, and a rename of a missing bookmark is refused', async () => {
        await store.add('chat-1', { itemId: 'a', excerpt: 'x', name: 'Decision' }, 10);
        expect(await store.rename('chat-1', 'a', '   ')).toEqual([{ itemId: 'a', excerpt: 'x', createdAt: 10 }]);
        await expect(store.rename('chat-1', 'b', 'Other')).rejects.toMatchObject({ code: 'bookmark-not-found' });
    });

    test('every change tells the whole list in the order it was written', async () => {
        await Promise.all([
            store.add('chat-1', { itemId: 'a', excerpt: 'x' }, 10),
            store.add('chat-1', { itemId: 'b', excerpt: 'y' }, 11),
            store.remove('chat-1', 'a')
        ]);
        expect(told.map((entry) => entry.bookmarks.map((bookmark) => bookmark.itemId))).toEqual([['a'], ['a', 'b'], ['b']]);
    });

    test('removing a bookmark that is gone changes nothing, and the last one leaves no file behind', async () => {
        await store.add('chat-1', { itemId: 'a', excerpt: 'x' }, 10);
        expect(await store.remove('chat-1', 'b')).toHaveLength(1);
        expect(await store.remove('chat-1', 'a')).toEqual([]);
        expect(told).toHaveLength(2);
        expect(await readdir(join(home, 'chats'))).toEqual([]);
    });

    test('a fork keeps only the bookmarks on the messages it copied', async () => {
        await store.add('chat-1', { itemId: 'a', excerpt: 'x' }, 10);
        await store.add('chat-1', { itemId: 'b', excerpt: 'y' }, 11);
        await store.copyChat('chat-1', 'fork-1', (itemId) => itemId === 'a');
        expect(await store.read('fork-1')).toEqual([{ itemId: 'a', excerpt: 'x', createdAt: 10 }]);
        expect(told.at(-1)).toEqual({ chatId: 'fork-1', bookmarks: [{ itemId: 'a', excerpt: 'x', createdAt: 10 }] });
    });

    test('removing a chat drops its file and says the list is empty; a chat without one tells nobody', async () => {
        await store.add('chat-1', { itemId: 'a', excerpt: 'x' }, 10);
        await store.removeChat('chat-1');
        await store.removeChat('chat-2');
        expect(await store.read('chat-1')).toEqual([]);
        expect(told.map((entry) => entry.chatId)).toEqual(['chat-1', 'chat-1']);
        expect(told.at(-1)?.bookmarks).toEqual([]);
    });

    test('a file that does not parse is refused rather than read as empty', async () => {
        await store.add('chat-1', { itemId: 'a', excerpt: 'x' }, 10);
        await writeFile(join(home, 'chats', bookmarkFileName('chat-1')), JSON.stringify({ version: 1, bookmarks: [{ itemId: '' }] }));
        await expect(store.read('chat-1')).rejects.toThrow('not valid');
        await expect(store.add('chat-1', { itemId: 'b', excerpt: 'y' }, 11)).rejects.toThrow('not valid');
    });
});
