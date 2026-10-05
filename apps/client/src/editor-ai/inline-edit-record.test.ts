import { describe, expect, test } from 'bun:test';
import type { LastProjectStorage } from '@/project/last-project';
import {
    expiredInlineEdits,
    forgetInlineEdit,
    INLINE_EDIT_KEEP_MS,
    inlineEditFor,
    readInlineEdits,
    saveInlineEdit,
    type InlineEditRecord
} from './inline-edit-record';

class MemoryStorage implements LastProjectStorage {
    readonly items = new Map<string, string>();

    getItem(key: string): string | null {
        return this.items.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        this.items.set(key, value);
    }

    removeItem(key: string): void {
        this.items.delete(key);
    }
}

function record(path: string, extra: Partial<InlineEditRecord> = {}): InlineEditRecord {
    return {
        chatId: `chat-${path}`,
        viewId: `chat-${path}`,
        projectId: 'p1',
        path,
        range: { start: { line: 1, character: 0 }, end: { line: 3, character: 4 } },
        selectedText: 'let a = 1;',
        instruction: 'rename it',
        provider: 'claude',
        model: null,
        createdAt: 1000,
        ...extra
    };
}

describe('the records of inline edits', () => {
    test('are kept per machine and path', () => {
        const storage = new MemoryStorage();

        saveInlineEdit('local', record('/work/a.ts'), storage);
        saveInlineEdit('local', record('/work/b.ts'), storage);
        saveInlineEdit('other', record('/work/a.ts', { chatId: 'chat-other' }), storage);

        expect(Object.keys(readInlineEdits('local', storage))).toEqual(['/work/a.ts', '/work/b.ts']);
        expect(inlineEditFor('other', '/work/a.ts', storage)?.chatId).toBe('chat-other');
        expect(inlineEditFor('local', '/work/c.ts', storage)).toBeNull();
    });

    test('a new edit in a file takes the place of the old one and hands it back to be removed', () => {
        const storage = new MemoryStorage();
        saveInlineEdit('local', record('/work/a.ts', { chatId: 'chat-1' }), storage);

        const replaced = saveInlineEdit('local', record('/work/a.ts', { chatId: 'chat-2' }), storage);

        expect(replaced?.chatId).toBe('chat-1');
        expect(inlineEditFor('local', '/work/a.ts', storage)?.chatId).toBe('chat-2');
        expect(saveInlineEdit('local', record('/work/a.ts', { chatId: 'chat-2', instruction: 'again' }), storage)).toBeNull();
    });

    test('forgetting leaves a newer record of the file alone', () => {
        const storage = new MemoryStorage();
        saveInlineEdit('local', record('/work/a.ts', { chatId: 'chat-2' }), storage);

        forgetInlineEdit('local', '/work/a.ts', 'chat-1', storage);
        expect(inlineEditFor('local', '/work/a.ts', storage)?.chatId).toBe('chat-2');

        forgetInlineEdit('local', '/work/a.ts', 'chat-2', storage);
        expect(storage.items.size).toBe(0);
    });

    test('expire after seven days, oldest first', () => {
        const storage = new MemoryStorage();
        saveInlineEdit('local', record('/work/new.ts', { createdAt: 5 * 86_400_000 }), storage);
        saveInlineEdit('local', record('/work/old.ts', { createdAt: 100 }), storage);
        saveInlineEdit('local', record('/work/older.ts', { createdAt: 50 }), storage);

        const expired = expiredInlineEdits('local', 100 + INLINE_EDIT_KEEP_MS, storage);

        expect(expired.map((entry) => entry.path)).toEqual(['/work/older.ts', '/work/old.ts']);
    });

    test('leave out what does not read as a record and survive a broken value', () => {
        const storage = new MemoryStorage();
        storage.setItem('ruimte.inlineEdits.local', JSON.stringify({ '/a.ts': { chatId: 1 }, '/b.ts': record('/b.ts') }));
        expect(Object.keys(readInlineEdits('local', storage))).toEqual(['/b.ts']);

        storage.setItem('ruimte.inlineEdits.local', '{broken');
        expect(readInlineEdits('local', storage)).toEqual({});
        expect(readInlineEdits('local', null)).toEqual({});
    });
});
