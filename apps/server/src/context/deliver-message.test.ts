import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { ManualClock } from '@adecore/agents/testing';
import type { ProjectContent } from '@ruimte/contracts';
import type { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, itemsOf, releasedProject, turnsOf, invokeTool, type TestDaemon } from '../testing/test-daemon.ts';
import { NO_REPLY_NOTICE } from './notices.ts';

/* Two chats a person opened beside each other, plus a note nothing links to: a message travels only along a line. */
function content(): ProjectContent {
    return {
        name: 'repo',
        color: '#123456',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [
                    { id: 'chat-lead', kind: 'chat', title: 'Lead', x: 0, y: 0, w: 560, h: 640, provider: 'claude' },
                    { id: 'chat-other', kind: 'chat', title: 'Builder', x: 600, y: 0, w: 560, h: 640, provider: 'claude' },
                    { id: 'chat-third', kind: 'chat', title: 'Reviewer', x: 1200, y: 0, w: 560, h: 640, provider: 'claude' },
                    { id: 'note-1', kind: 'note', title: 'A note', x: 600, y: 700, w: 320, h: 200 }
                ],
                texts: [],
                edges: [],
                layouts: []
            }
        ]
    };
}

let root: string;
let home: string;
let folder: string;
let store: ProjectStore;
let clock: ManualClock;
let running: TestDaemon[];

beforeEach(async () => {
    ({ root, home, folder, store } = await releasedProject('ruimte-message-', content()));
    clock = new ManualClock();
    running = [];
});

afterEach(async () => {
    for (const daemon of running) {
        await daemon.stop();
    }
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

async function boot(): Promise<TestDaemon> {
    const daemon = await bootTestDaemon({ home, store, clock });
    daemon.worker.start();
    running.push(daemon);
    return daemon;
}

/* What the CLI answered, which is the prompt it was handed echoed back: the message is in there or it never reached it. */
function repliesOf(daemon: TestDaemon, chatId: string): string[] {
    return itemsOf(daemon, chatId).flatMap((item) => (item.kind === 'assistant' ? [item.text] : []));
}

/* A chat with a finished turn behind it, which is a chat a message can open a turn in. */
async function idle(daemon: TestDaemon, chatId: string): Promise<void> {
    await daemon.chats.create({ chatId, provider: 'claude', cwd: folder });
    await daemon.chats.send(chatId, 'plan the work');
    await daemon.until(() => turnsOf(daemon, chatId).some((turn) => turn.state === 'done'));
}

/* The line a message travels along; `to` on a chat draws it both ways, so the two can answer each other. */
async function link(daemon: TestDaemon, from: string, to: string): Promise<void> {
    await invokeTool(daemon, from, 'link_new', { to });
}

async function notify(daemon: TestDaemon, from: string, to: string, text: string): Promise<string[]> {
    return invokeTool(daemon, from, 'notify', { id: to, text });
}

/* The line notify prints, which every answer ends with the same way. */
function notified(id: string, at: string, detail: string, title: string): string {
    return `notified\t${id}\t${at}\t${detail}; ${NO_REPLY_NOTICE}\t${title}`;
}

/* What a person reads in the thread about a message, wherever it was written. */
function linesAbout(daemon: TestDaemon, chatId: string, text: string): string[] {
    return itemsOf(daemon, chatId).flatMap((item) => (item.kind === 'note' && item.text.includes(text) ? [item.text] : []));
}

describe('a message to a chat', () => {
    test('gives a chat between turns a turn of its own, and the agent reads the message in it', async () => {
        const daemon = await boot();
        await idle(daemon, 'chat-lead');
        await idle(daemon, 'chat-other');
        await link(daemon, 'chat-lead', 'chat-other');

        const lines = await notify(daemon, 'chat-lead', 'chat-other', 'what is the secret word');
        expect(lines).toEqual([notified('chat-other', 'now', 'that chat takes a turn on it, and reads it there', 'Builder')]);

        await daemon.until(() => turnsOf(daemon, 'chat-other').some((turn) => (turn.messageFrom ?? []).length > 0 && turn.state === 'done'));
        const turn = turnsOf(daemon, 'chat-other').find((candidate) => (candidate.messageFrom ?? []).length > 0)!;
        expect(turn.messageFrom).toEqual(['chat-lead']);
        expect(turn.origin).toBe('agent');
        expect(turn.label).toBe('Message from Lead');
        /* One line for a person: the one written as the message landed, outside any turn. The turn it
           opened says nothing more about it, and the label above it already names who wrote. */
        expect(linesAbout(daemon, 'chat-other', 'what is the secret word')).toEqual(['Lead sent a message: what is the secret word']);
        expect(itemsOf(daemon, 'chat-other').some((item) => item.kind === 'note' && item.text.startsWith('Woken by'))).toBe(false);
        /* And the model heard it once, in the prompt of that turn: the fake echoes what it was given. */
        expect(repliesOf(daemon, 'chat-other').filter((text) => text.includes('sent you a message: what is the secret word'))).toHaveLength(1);
        expect(repliesOf(daemon, 'chat-other').at(-1)).toContain('node chat-lead ("Lead") sent you a message: what is the secret word');
        expect(daemon.notices.waiting('chat-other')).toEqual([]);
        expect(daemon.outbox.list()).toEqual([]);
    });

    test('an answer to the chat that asked wakes it, once', async () => {
        const daemon = await boot();
        await idle(daemon, 'chat-lead');
        await idle(daemon, 'chat-other');
        await link(daemon, 'chat-lead', 'chat-other');

        // The second line keeps the woken turn open, so the answer goes out while that turn runs.
        await notify(daemon, 'chat-lead', 'chat-other', 'what is the secret word\\nslow');
        await daemon.until(() => daemon.chats.get('chat-other')?.info.activeTurnId !== null);

        const lines = await notify(daemon, 'chat-other', 'chat-lead', 'the word is walnut');
        expect(lines).toEqual([notified('chat-lead', 'now', 'that chat takes a turn on it, and reads it there', 'Lead')]);
        await daemon.until(() => repliesOf(daemon, 'chat-lead').some((text) => text.includes('the word is walnut')));
        expect(turnsOf(daemon, 'chat-lead').filter((turn) => (turn.messageFrom ?? []).length > 0)).toEqual([
            expect.objectContaining({ messageFrom: ['chat-other'] })
        ]);
        daemon.chats.cancel('chat-other');
    });

    test('sent from a turn a message started moves the next chat along the chain', async () => {
        const daemon = await boot();
        await idle(daemon, 'chat-lead');
        await idle(daemon, 'chat-other');
        await idle(daemon, 'chat-third');
        await link(daemon, 'chat-lead', 'chat-other');
        await link(daemon, 'chat-other', 'chat-third');

        await notify(daemon, 'chat-lead', 'chat-other', 'what is the secret word\\nslow');
        await daemon.until(() => daemon.chats.get('chat-other')?.info.activeTurnId !== null);
        const before = turnsOf(daemon, 'chat-third').length;

        const lines = await notify(daemon, 'chat-other', 'chat-third', 'the word is walnut');
        expect(lines).toEqual([notified('chat-third', 'now', 'that chat takes a turn on it, and reads it there', 'Reviewer')]);
        await daemon.until(() => repliesOf(daemon, 'chat-third').some((text) => text.includes('the word is walnut')));
        expect(turnsOf(daemon, 'chat-third').length).toBeGreaterThan(before);
        expect(turnsOf(daemon, 'chat-third').at(-1)?.messageHop).toBe(2);
        daemon.chats.cancel('chat-other');
    });

    test('to a chat that is in a turn keeps that turn, and lands in front of its next one', async () => {
        const daemon = await boot();
        await idle(daemon, 'chat-lead');
        await idle(daemon, 'chat-other');
        await link(daemon, 'chat-lead', 'chat-other');
        await daemon.chats.send('chat-other', 'slow');
        await daemon.until(() => daemon.chats.get('chat-other')?.info.activeTurnId !== null);
        const before = turnsOf(daemon, 'chat-other').length;

        const lines = await notify(daemon, 'chat-lead', 'chat-other', 'the build is green');
        expect(lines).toEqual([
            notified(
                'chat-other',
                'waiting',
                'that chat is in a turn; it reads the message at the latest in a turn of its own when this one ends (1 waiting)',
                'Builder'
            )
        ]);
        expect(daemon.outbox.list().filter((entry) => entry.kind === 'deliver-message')).toEqual([]);
        expect(turnsOf(daemon, 'chat-other')).toHaveLength(before);

        daemon.chats.cancel('chat-other');
        await daemon.chats.send('chat-other', 'carry on');
        await daemon.until(() => repliesOf(daemon, 'chat-other').some((text) => text.includes('sent you a message: the build is green')));
        // The turn a person's prompt opened, not one the machine started for the message.
        expect(turnsOf(daemon, 'chat-other').every((turn) => (turn.messageFrom ?? []).length === 0)).toBe(true);
    });

    test('to a terminal changes nothing: it goes on the screen and starts no turn', async () => {
        const daemon = await boot();
        await idle(daemon, 'chat-lead');
        const [line] = await invokeTool(daemon, 'chat-lead', 'agent_start', { cli: 'claude', terminal: true, prompt: 'look around' });
        const termId = line!.split('\t')[0]!;
        await daemon.until(() => daemon.sessions.get(termId) !== undefined);

        const lines = await notify(daemon, 'chat-lead', termId, 'the build is green');
        expect(lines).toEqual([notified(termId, 'now', 'printed on the screen of that terminal', 'Claude Code')]);
        expect(daemon.outbox.list().filter((entry) => entry.kind === 'deliver-message')).toEqual([]);
        // A shell with no agent in it reads the line off its screen, so nothing is left waiting either.
        expect(daemon.notices.waiting(termId)).toEqual([]);
    });
});
