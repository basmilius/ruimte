import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentInfo } from '@ruimte/contracts';
import { deliverNotice, MAX_NOTICES, NOTICE_MAX_AGE_MS, NoticeStore, renderNotice, type Notice, type NoticeTargets } from './notices.ts';

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
        await Bun.sleep(20);
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
        const deps = targets({ terminal: () => ({ agent: agent('codex'), notice: (text) => printed.push(text) }) });
        const delivery = await deliverNotice(store, deps, left('the build is green'));
        expect(delivery.at).toBe('now');
        expect(delivery.detail).toContain('codex takes nothing between its turns');
        expect(printed).toHaveLength(1);
    });

    test('a chat waits for its next prompt, and a node that runs nothing waits to start', async () => {
        const chat = await deliverNotice(store, targets({ hasChat: () => true }), left('the build is green'));
        expect(chat).toEqual({ at: 'waiting', detail: 'the chat reads it in front of its next prompt (1 waiting)' });
        const cold = await deliverNotice(store, targets(), left('and another', 'term-3'));
        expect(cold.detail).toStartWith('nothing runs in that node yet');
    });
});
