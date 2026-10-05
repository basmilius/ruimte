import { beforeEach, describe, expect, test } from 'bun:test';
import type { LastProjectStorage } from '@/project/last-project';
import { TransportError } from '@/transport/transport';
import { INLINE_EDIT_KEEP_MS, inlineEditFor, saveInlineEdit, type InlineEditRecord } from './inline-edit-record';
import { pruneInlineEdits } from './inline-edit-prune';

const DAY = 24 * 60 * 60 * 1000;
let items: Map<string, string>;
let storage: LastProjectStorage;

function record(path: string, createdAt: number): InlineEditRecord {
    return {
        chatId: `chat-${path}`,
        viewId: `chat-${path}`,
        projectId: 'p1',
        path,
        range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
        selectedText: 'x',
        instruction: 'y',
        provider: 'claude',
        model: null,
        createdAt
    };
}

beforeEach(() => {
    items = new Map();
    storage = {
        getItem: (key) => items.get(key) ?? null,
        setItem: (key, value) => void items.set(key, value),
        removeItem: (key) => void items.delete(key)
    };
});

describe('pruning old inline edits', () => {
    test('removes the hidden chat of every record older than a week and keeps the others', async () => {
        saveInlineEdit('local', record('/a.ts', 0), storage);
        saveInlineEdit('local', record('/b.ts', 5 * DAY), storage);
        const removed: string[] = [];

        const complete = await pruneInlineEdits('local', {
            now: () => INLINE_EDIT_KEEP_MS + 1,
            remove: async (_projectId, viewId) => void removed.push(viewId),
            storage
        });

        expect(complete).toBe(true);
        expect(removed).toEqual(['chat-/a.ts']);
        expect(inlineEditFor('local', '/a.ts', storage)).toBeNull();
        expect(inlineEditFor('local', '/b.ts', storage)).not.toBeNull();
    });

    test('keeps what it could not reach for the next try, and drops a chat the machine no longer knows', async () => {
        saveInlineEdit('local', record('/a.ts', 0), storage);
        saveInlineEdit('local', record('/b.ts', 1), storage);
        const attempts: string[] = [];

        const offline = await pruneInlineEdits('local', {
            now: () => 8 * DAY,
            remove: async (_projectId, viewId) => {
                attempts.push(viewId);
                throw new TransportError('not-connected', 'away');
            },
            storage
        });
        expect(offline).toBe(false);
        expect(attempts).toEqual(['chat-/a.ts']);
        expect(inlineEditFor('local', '/a.ts', storage)).not.toBeNull();

        const gone = await pruneInlineEdits('local', {
            now: () => 8 * DAY,
            remove: async () => {
                throw new TransportError('project-not-found', 'No such project');
            },
            storage
        });
        expect(gone).toBe(true);
        expect(inlineEditFor('local', '/a.ts', storage)).toBeNull();
        expect(inlineEditFor('local', '/b.ts', storage)).toBeNull();
    });
});
