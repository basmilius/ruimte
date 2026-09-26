import { describe, expect, test } from 'bun:test';
import { bookmarkLabel, bookmarksInThreadOrder } from './bookmarks';

describe('bookmarks', () => {
    test('the list follows the thread, and a bookmark on a message this client lacks goes last', () => {
        const bookmarks = [
            { itemId: 'gone', excerpt: 'old', createdAt: 1 },
            { itemId: 'b', excerpt: 'second', createdAt: 2 },
            { itemId: 'a', excerpt: 'first', name: 'Decision', createdAt: 3 }
        ];
        expect(bookmarksInThreadOrder(bookmarks, ['a', 'x', 'b']).map((bookmark) => bookmark.itemId)).toEqual(['a', 'b', 'gone']);
        expect(bookmarks.map(bookmarkLabel)).toEqual(['old', 'second', 'Decision']);
    });
});
