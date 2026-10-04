import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NoticeStore, type Notice } from '@ruimte/agents/messages/notice-store';
import type { AgentInfo } from '@ruimte/contracts';
import { deliverNotice, messageLabel, messageText, NO_REPLY_NOTICE, noticeNote, renderNotice, type NoticeTargets } from './notices.ts';

let home: string;
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

function agent(kind: AgentInfo['kind'], live = true): AgentInfo {
    return {
        kind,
        agentSessionId: 'a1',
        transcriptPath: null,
        status: 'running',
        live,
        updatedAt: 0
    };
}

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-notices-'));
    clock = 1_000_000;
    store = new NoticeStore(home, () => clock);
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe('the words of a message', () => {
    test('reads to the receiver as an id it can act on and a title it can read', () => {
        expect(renderNotice({ ...left('the build is green'), createdAt: 0 })).toBe('Ruimte: node term-1 ("shell") sent you a message: the build is green');
    });

    test('reads to a person as the name on the canvas, and falls back to the id of a node without one', () => {
        expect(noticeNote({ ...left('the build is green'), createdAt: 0 })).toBe('shell sent a message: the build is green');
        expect(noticeNote({ ...left('the build is green'), fromTitle: '', createdAt: 0 })).toBe('Node term-1 sent a message: the build is green');
    });

    test('labels a woken turn by each sender once, and tells its agent that a message starts one turn', () => {
        const notice = (from: string, fromTitle: string): Notice => ({ ...left('hi'), from, fromTitle, createdAt: 0 });
        expect(messageLabel([notice('term-1', 'shell')])).toBe('Message from shell');
        expect(messageLabel([notice('term-1', 'shell'), notice('term-3', ''), notice('term-1', 'shell')])).toBe('Messages from shell, node term-3');
        expect(messageText(2)).toStartWith('2 nodes linked to you sent you the messages above.');
        expect(messageText(1)).toContain('A message starts one turn and no further');
    });
});

describe('deliverNotice', () => {
    const targets = (overrides: Partial<NoticeTargets> = {}): NoticeTargets => ({
        terminal: () => null,
        chat: async () => 'none',
        fromMessage: () => false,
        ...overrides
    });

    /* Where the message went, plus the tail every answer carries. */
    const answer = (detail: string): string => `${detail}; ${NO_REPLY_NOTICE}`;

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
        expect(delivery).toEqual({
            at: 'waiting',
            wake: false,
            detail: answer('its agent reads it at the start of its next turn, which nothing here starts (1 waiting)')
        });
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

    test('a chat between turns is owed one, and hears the message in it', async () => {
        const delivery = await deliverNotice(store, targets({ chat: async () => 'idle' }), left('the build is green', 'chat-2'));
        expect(delivery).toEqual({ at: 'now', wake: true, detail: answer('that chat takes a turn on it, and reads it there') });
        // The message stays in the queue; the turn's preamble is what takes it.
        expect(store.waiting('chat-2')).toHaveLength(1);
    });

    test('a chat in a turn keeps it, and a node that runs nothing waits to start', async () => {
        const busy = await deliverNotice(store, targets({ chat: async () => 'running' }), left('the build is green', 'chat-2'));
        expect(busy).toEqual({
            at: 'waiting',
            wake: false,
            detail: answer('that chat is in a turn; it reads the message in front of its next one (1 waiting)')
        });
        const cold = await deliverNotice(store, targets(), left('and another', 'term-3'));
        expect(cold.detail).toStartWith('nothing runs in that node yet');
        expect(cold.wake).toBe(false);
    });

    test('a sender in a turn a message started wakes nobody, and hears why', async () => {
        const delivery = await deliverNotice(
            store,
            targets({ chat: async () => 'idle', fromMessage: (id) => id === 'term-1' }),
            left('and what about the tests', 'chat-2')
        );
        expect(delivery).toEqual({
            at: 'waiting',
            wake: false,
            detail: answer(
                'a message started the turn you are in, and a message starts one turn and no further; that chat reads this one in front of its next turn (1 waiting)'
            )
        });
        expect(store.waiting('chat-2')).toHaveLength(1);
    });

    /* The sender reads this line at the one moment it decides whether to wait, so every road out says it. */
    test('every answer tells the sender that nothing comes back, and what does', async () => {
        const deliveries = [
            await deliverNotice(store, targets({ chat: async () => 'idle' }), left('the build is green', 'chat-2')),
            await deliverNotice(store, targets({ chat: async () => 'running' }), left('and the tests', 'chat-3')),
            await deliverNotice(store, targets({ chat: async () => 'idle', fromMessage: () => true }), left('and the docs', 'chat-4')),
            await deliverNotice(store, targets(), left('and the types', 'chat-5')),
            await deliverNotice(store, targets({ terminal: () => ({ agent: null, notice: () => {} }) }), left('and the lint', 'term-9')),
            await deliverNotice(store, targets({ terminal: () => ({ agent: agent('claude'), notice: () => {} }) }), left('and the rest', 'term-8'))
        ];
        for (const delivery of deliveries) {
            expect(delivery.detail).toEndWith(`; ${NO_REPLY_NOTICE}`);
        }
        expect(NO_REPLY_NOTICE).toBe('nothing comes back to you, and ruimte-context task new is what brings a result back');
    });
});
