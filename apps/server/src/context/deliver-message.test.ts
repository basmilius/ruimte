import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatItem, ChatTurnItem, ProjectContent } from '@ruimte/contracts';
import { ManualClock } from '../outbox/manual-clock.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, runVerb, type TestDaemon } from '../tasks/test-daemon.ts';

/* Two chats a person opened beside each other, a shell and a note: a message travels only along a line. */
const content = (): ProjectContent => ({
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
                { id: 'note-1', kind: 'note', title: 'A note', x: 600, y: 700, w: 320, h: 200 }
            ],
            texts: [],
            edges: [],
            layouts: []
        }
    ]
});

let root: string;
let home: string;
let folder: string;
let store: ProjectStore;
let projectId: string;
let clock: ManualClock;
let running: TestDaemon[];

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-message-'));
    home = join(root, 'home');
    folder = join(root, 'repo');
    await mkdir(folder, { recursive: true });
    store = new ProjectStore(home);
    const opened = await store.openProject({ folder });
    projectId = opened.summary.projectId;
    await store.save(projectId, opened.document.rev, content());
    store.release(projectId);
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

const boot = async (): Promise<TestDaemon> => {
    const daemon = await bootTestDaemon({ home, store, clock });
    daemon.worker.start();
    running.push(daemon);
    return daemon;
};

const itemsOf = (daemon: TestDaemon, chatId: string): ChatItem[] => daemon.chats.get(chatId)?.thread.list() ?? [];

const turnsOf = (daemon: TestDaemon, chatId: string): ChatTurnItem[] => itemsOf(daemon, chatId).filter((item): item is ChatTurnItem => item.kind === 'turn');

/* What the CLI answered, which is the prompt it was handed echoed back: the message is in there or it never reached it. */
const repliesOf = (daemon: TestDaemon, chatId: string): string[] => itemsOf(daemon, chatId).flatMap((item) => (item.kind === 'assistant' ? [item.text] : []));

/* A chat with a finished turn behind it, which is a chat a message can open a turn in. */
const idle = async (daemon: TestDaemon, chatId: string): Promise<void> => {
    await daemon.chats.create({ chatId, provider: 'claude', cwd: folder });
    await daemon.chats.send(chatId, 'plan the work');
    await daemon.until(() => turnsOf(daemon, chatId).some((turn) => turn.state === 'done'));
};

/* The line a message travels along; `--to` on a chat draws it both ways, so the two can answer each other. */
const link = async (daemon: TestDaemon, from: string, to: string): Promise<void> => {
    await runVerb(daemon, from, 'link', ['new', '--to', to]);
};

const notify = async (daemon: TestDaemon, from: string, to: string, text: string): Promise<string[]> => runVerb(daemon, from, 'notify', [to, '--text', text]);

describe('a message to a chat', () => {
    test('gives a chat between turns a turn of its own, and the agent reads the message in it', async () => {
        const daemon = await boot();
        await idle(daemon, 'chat-lead');
        await idle(daemon, 'chat-other');
        await link(daemon, 'chat-lead', 'chat-other');

        const lines = await notify(daemon, 'chat-lead', 'chat-other', 'what is the secret word');
        expect(lines).toEqual(['notified\tchat-other\tnow\tthat chat takes a turn on it, and reads it there']);

        await daemon.until(() => turnsOf(daemon, 'chat-other').some((turn) => (turn.messageFrom ?? []).length > 0 && turn.state === 'done'));
        const turn = turnsOf(daemon, 'chat-other').find((candidate) => (candidate.messageFrom ?? []).length > 0)!;
        expect(turn.messageFrom).toEqual(['chat-lead']);
        expect(turn.origin).toBe('agent');
        expect(turn.label).toBe('Message from Lead');
        // The turn's own prompt carried the message, so the agent saw it and not only the thread.
        expect(repliesOf(daemon, 'chat-other').at(-1)).toContain('node chat-lead ("Lead") sent you a message: what is the secret word');
        // A note above the turn says what woke the chat, and the message is out of the queue.
        expect(itemsOf(daemon, 'chat-other').some((item) => item.kind === 'note' && item.text === 'Woken by a message')).toBe(true);
        expect(daemon.notices.waiting('chat-other')).toEqual([]);
        expect(daemon.outbox.list()).toEqual([]);
    });

    test('sent from a turn a message started wakes nobody, and says why', async () => {
        const daemon = await boot();
        await idle(daemon, 'chat-lead');
        await idle(daemon, 'chat-other');
        await link(daemon, 'chat-lead', 'chat-other');

        // The second line keeps the woken turn open, so the answer goes out while that turn runs.
        await notify(daemon, 'chat-lead', 'chat-other', 'what is the secret word\\nslow');
        await daemon.until(() => daemon.chats.get('chat-other')?.info.activeTurnId !== null);
        const before = turnsOf(daemon, 'chat-lead').length;

        const lines = await notify(daemon, 'chat-other', 'chat-lead', 'the word is walnut');
        expect(lines).toEqual([
            'notified\tchat-lead\twaiting\ta message started the turn you are in, and a message starts one turn and no further; that chat reads this one in front of its next turn (1 waiting)'
        ]);
        // The lead is between turns and still gets none: this is the step the daemon does not take.
        expect(daemon.chats.get('chat-lead')?.info.activeTurnId).toBeNull();
        expect(turnsOf(daemon, 'chat-lead')).toHaveLength(before);
        expect(daemon.outbox.list().filter((entry) => entry.kind === 'deliver-message')).toEqual([]);
        expect(daemon.notices.waiting('chat-lead')).toHaveLength(1);

        // What was said still reaches the lead, in the next turn a person gives it.
        daemon.chats.cancel('chat-other');
        await daemon.chats.send('chat-lead', 'anything back?');
        await daemon.until(() => repliesOf(daemon, 'chat-lead').some((text) => text.includes('the word is walnut')));
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
        expect(lines).toEqual(['notified\tchat-other\twaiting\tthat chat is in a turn; it reads the message in front of its next one (1 waiting)']);
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
        const [line] = await runVerb(daemon, 'chat-lead', 'agent', ['claude', '--terminal', '--prompt', 'look around']);
        const termId = line!.split('\t')[0]!;
        await daemon.until(() => daemon.sessions.get(termId) !== undefined);

        const lines = await notify(daemon, 'chat-lead', termId, 'the build is green');
        expect(lines).toEqual([`notified\t${termId}\tnow\tprinted on the screen of that terminal`]);
        expect(daemon.outbox.list().filter((entry) => entry.kind === 'deliver-message')).toEqual([]);
        // A shell with no agent in it reads the line off its screen, so nothing is left waiting either.
        expect(daemon.notices.waiting(termId)).toEqual([]);
    });
});
