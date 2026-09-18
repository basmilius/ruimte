import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentInfo } from '@ruimte/contracts';
import {
    deliverNotice,
    MAX_NOTICES,
    NOTICE_MAX_AGE_MS,
    noticeNote,
    NoticeStore,
    renderNotice,
    showNotices,
    type Notice,
    type NoticeChat,
    type NoticeTargets
} from './notices.ts';

let home: string;
let clock: number;
let store: NoticeStore;

const left = (text: string, targetId = 'term-2'): Omit<Notice, 'createdAt'> => ({
    projectId: 'project-1',
    targetId,
    from: 'term-1',
    fromTitle: 'shell',
    text
});

const agent = (kind: AgentInfo['kind'], live = true): AgentInfo => ({
    kind,
    agentSessionId: 'a1',
    transcriptPath: null,
    status: 'running',
    live,
    updatedAt: 0
});

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-notices-'));
    clock = 1_000_000;
    store = new NoticeStore(home, () => clock);
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe('NoticeStore', () => {
    test('holds a message until it is taken, and hands it over once', async () => {
        expect(await store.put(left('the build is green'))).toBe(1);
        expect(store.waiting('term-2')).toHaveLength(1);
        expect(store.take('term-2').map((notice) => notice.text)).toEqual(['the build is green']);
        expect(store.take('term-2')).toEqual([]);
        // The file follows the memory; taking is synchronous, so the write is still on its way here.
        await store.settled();
        expect(await readdir(join(home, 'notices'))).toEqual([]);
    });

    test('survives a restart of the daemon, since the receiver may not have started yet', async () => {
        await store.put(left('read the plan'));
        const next = new NoticeStore(home, () => clock);
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

    test('reads to the receiver as an id it can act on and a title it can read', () => {
        expect(renderNotice({ ...left('the build is green'), createdAt: 0 })).toBe('Ruimte: node term-1 ("shell") sent you a message: the build is green');
    });

    test('reads to a person as the name on the canvas, and falls back to the id of a node without one', () => {
        expect(noticeNote({ ...left('the build is green'), createdAt: 0 })).toBe('shell sent a message: the build is green');
        expect(noticeNote({ ...left('the build is green'), fromTitle: '', createdAt: 0 })).toBe('Node term-1 sent a message: the build is green');
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
        const next = new NoticeStore(home, () => clock);
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
        await store.put(left('the build is green', 'chat-2'));
        await store.put(left('and the tests', 'chat-2'));
        await showNotices(store, chat(true, lines), 'chat-2');
        await showNotices(store, chat(true, lines), 'chat-2');
        expect(lines).toEqual(['shell sent a message: the build is green', 'shell sent a message: and the tests']);
    });

    test('an id no chat holds keeps its messages unshown, for the chat that opens on it later', async () => {
        const lines: string[] = [];
        await store.put(left('read the plan', 'chat-3'));
        await showNotices(store, chat(false, lines), 'chat-3');
        expect(lines).toEqual([]);
        await showNotices(store, chat(true, lines), 'chat-3');
        expect(lines).toEqual(['shell sent a message: read the plan']);
    });
});

describe('deliverNotice', () => {
    const targets = (overrides: Partial<NoticeTargets> = {}): NoticeTargets => ({
        terminal: () => null,
        hasChat: () => false,
        ...overrides
    });

    test('a shell with no agent in it gets the line on its screen at once', async () => {
        const printed: string[] = [];
        const deps = targets({ terminal: () => ({ agent: null, notice: (text) => printed.push(text) }) });
        const delivery = await deliverNotice(store, deps, left('the build is green'));
        expect(delivery.at).toBe('now');
        expect(printed[0]).toStartWith('Ruimte: node term-1 ("shell")');
        expect(store.waiting('term-2')).toEqual([]);
    });

    test('an agent that answers a context hook is left to finish its turn', async () => {
        const printed: string[] = [];
        const deps = targets({ terminal: () => ({ agent: agent('claude'), notice: (text) => printed.push(text) }) });
        const delivery = await deliverNotice(store, deps, left('the build is green'));
        expect(delivery).toEqual({ at: 'waiting', detail: 'its agent reads it at the start of its next turn (1 waiting)' });
        expect(printed).toEqual([]);
        expect(store.waiting('term-2')).toHaveLength(1);
    });

    test('a CLI that takes nothing between turns gets the screen, and the answer says so', async () => {
        const printed: string[] = [];
        const deps = targets({ terminal: () => ({ agent: agent('gemini'), notice: (text) => printed.push(text) }) });
        const delivery = await deliverNotice(store, deps, left('the build is green'));
        expect(delivery.at).toBe('now');
        expect(delivery.detail).toContain('gemini takes nothing between its turns');
        expect(printed).toHaveLength(1);
    });

    test('a chat waits for its next prompt, and a node that runs nothing waits to start', async () => {
        const chat = await deliverNotice(store, targets({ hasChat: () => true }), left('the build is green'));
        expect(chat).toEqual({ at: 'waiting', detail: 'the chat reads it in front of its next prompt (1 waiting)' });
        const cold = await deliverNotice(store, targets(), left('and another', 'term-3'));
        expect(cold.detail).toStartWith('nothing runs in that node yet');
    });
});
