import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_NOTICES, NOTICE_MAX_AGE_MS, NoticeStore, type Notice } from './notice-store.ts';

let dataDir: string;
let clock: number;
let store: NoticeStore;

function left(text: string, targetId = 'term-2'): Omit<Notice, 'createdAt'> {
    return {
        projectId: 'project-1',
        targetId,
        from: 'term-1',
        fromTitle: 'shell',
        text
    };
}

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'agents-notices-'));
    clock = 1_000_000;
    store = new NoticeStore(dataDir, () => clock);
});

afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
});

describe('NoticeStore', () => {
    test('holds a message until it is taken, and hands it over once', async () => {
        expect(await store.put(left('the build is green'))).toBe(1);
        expect(store.waiting('term-2')).toHaveLength(1);
        expect(store.take('term-2').map((notice) => notice.text)).toEqual(['the build is green']);
        expect(store.take('term-2')).toEqual([]);
        // The file follows the memory; taking is synchronous, so the write is still on its way here.
        await store.settled();
        expect(await readdir(join(dataDir, 'notices'))).toEqual([]);
    });

    test('survives a restart of the host, since the receiver may not have started yet', async () => {
        await store.put(left('read the plan'));
        const next = new NoticeStore(dataDir, () => clock);
        await next.load();
        expect(next.take('term-2').map((notice) => notice.text)).toEqual(['read the plan']);
    });

    test('keeps the newest when a sender will not stop, and drops what nobody picked up', async () => {
        for (let i = 0; i < MAX_NOTICES + 3; i++) {
            await store.put(left(`message ${i}`));
        }
        const queue = store.waiting('term-2');
        expect(queue).toHaveLength(MAX_NOTICES);
        expect(queue[0]?.text).toBe('message 3');

        clock += NOTICE_MAX_AGE_MS + 1;
        expect(store.waiting('term-2')).toEqual([]);
        expect(store.take('term-2')).toEqual([]);
        // A fresh one after that stands alone: the stale ones do not count against the cap either.
        expect(await store.put(left('still here'))).toBe(1);
    });

    test('a node that was deleted takes what was left for it', async () => {
        await store.put(left('hello'));
        await store.prune('project-1', new Set(['term-1']));
        expect(store.waiting('term-2')).toEqual([]);
        // Another project's messages are not its to drop.
        await store.put(left('hello'));
        await store.prune('project-2', new Set());
        expect(store.waiting('term-2')).toHaveLength(1);
    });

    test('shows a message to a person once, and leaves the model its own copy', async () => {
        await store.put(left('the build is green'));
        expect((await store.show('term-2')).map((notice) => notice.text)).toEqual(['the build is green']);
        expect(await store.show('term-2')).toEqual([]);
        // Showing takes nothing away: the model still hears it, once, whenever it asks.
        expect(store.take('term-2').map((notice) => notice.text)).toEqual(['the build is green']);
        await store.settled();
    });

    test('remembers what was shown across a restart, so a reload leaves no second line in the thread', async () => {
        await store.put(left('read the plan'));
        await store.show('term-2');
        const next = new NoticeStore(dataDir, () => clock);
        await next.load();
        expect(await next.show('term-2')).toEqual([]);
        expect(next.take('term-2')).toHaveLength(1);
    });

    test('a message that came in after a show is shown too', async () => {
        await store.put(left('the build is green'));
        await store.show('term-2');
        await store.put(left('and the tests'));
        expect((await store.show('term-2')).map((notice) => notice.text)).toEqual(['and the tests']);
    });
});
