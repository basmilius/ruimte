import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NoticeNotes, unshownNotes } from './notice-notes.ts';
import { NoticeStore, type Notice } from './notice-store.ts';

let dataDir: string;
let store: NoticeStore;

const left = (text: string): Omit<Notice, 'createdAt'> => ({ projectId: 'project-1', targetId: 'chat-2', from: 'chat-1', fromTitle: 'Lead', text });

const words = {
    heard: (notice: Notice): string => `node ${notice.from} sent you: ${notice.text}`,
    shown: (notice: Notice): string => `${notice.fromTitle} wrote: ${notice.text}`
};

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'agents-notice-notes-'));
    store = new NoticeStore(dataDir);
});

afterEach(async () => {
    await store.settled();
    await rm(dataDir, { recursive: true, force: true });
});

describe('NoticeNotes', () => {
    test('the model hears what waits in front of its next prompt once, and a person is shown none of it again', async () => {
        await store.put(left('the build is green'));
        const notes = new NoticeNotes(store, 'chat-2', words);
        expect(notes.next()).toEqual({ shown: [], heard: ['node chat-1 sent you: the build is green'] });
        expect(notes.next()).toEqual({ shown: [], heard: [] });
        expect(store.waiting('chat-2')).toEqual([]);
    });
});

describe('unshownNotes', () => {
    test('a chat that loads shows what landed while nobody held it once, and leaves the model its copy', async () => {
        await store.put(left('read the plan'));
        expect(await unshownNotes(store, 'chat-2', words)).toEqual(['Lead wrote: read the plan']);
        expect(await unshownNotes(store, 'chat-2', words)).toEqual([]);
        expect(new NoticeNotes(store, 'chat-2', words).next().heard).toEqual(['node chat-1 sent you: read the plan']);
    });
});
