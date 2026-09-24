import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatInfo, ChatItem, ProjectContent } from '@ruimte/contracts';
import { AttachmentStore } from '../chat/attachment-store.ts';
import { ChatManager } from '../chat/chat-manager.ts';
import { RESUME_PROMPT } from '../chat/chat-session.ts';
import { ChatStore } from '../chat/chat-store.ts';
import type { SpawnChatProcess } from '../chat/chat-process.ts';
import { fakeClaude } from '../chat/fake-claude.ts';
import { fakeCodex } from '../chat/fake-codex.ts';
import { inProcess, type InProcessCli } from '../chat/fake-cli.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import { ManualClock } from './manual-clock.ts';
import { OutboxStore } from './outbox.ts';
import { OutboxWorker, RETRY_DELAYS_MS } from './outbox-worker.ts';
import { oweResume, resumeRunHandler, resumeRunParked } from './resume-run.ts';

const providers = new ProviderRegistry({ detect: async () => ({ installed: true, version: '0.0.0' }) });

const content = (): ProjectContent => ({
    name: 'repo',
    color: '#123456',
    views: [
        {
            kind: 'canvas',
            id: 'main',
            name: 'Canvas',
            nodes: [{ id: 'chat-child', kind: 'chat', title: 'Child', x: 0, y: 0, w: 560, h: 640, provider: 'claude' }],
            texts: [],
            edges: [],
            layouts: []
        },
        // A chat that is a view of its own rather than a node. The index places it the same way.
        { kind: 'chat', id: 'chat-view', name: 'Chat', node: { provider: 'claude' } }
    ]
});

/* One run of the daemon over a home. What it loads from disk, the chats and the outbox that owes their resumes. */
interface Daemon {
    chats: ChatManager;
    outbox: OutboxStore;
    worker: OutboxWorker;
    claude: InProcessCli;
    codex: InProcessCli;
    until(check: () => boolean): Promise<void>;
    stop(): Promise<void>;
}

let root: string;
let home: string;
let folder: string;
let projects: ProjectStore;
let clock: ManualClock;
let running: Daemon[];

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-resume-run-'));
    home = join(root, 'home');
    folder = join(root, 'repo');
    await mkdir(folder, { recursive: true });
    projects = new ProjectStore(home);
    const opened = await projects.openProject({ folder });
    await projects.save(opened.summary.projectId, opened.document.rev, content());
    projects.release(opened.summary.projectId);
    clock = new ManualClock();
    running = [];
});

afterEach(async () => {
    for (const daemon of running) {
        await daemon.stop();
    }
    projects.closeAll();
    await rm(root, { recursive: true, force: true });
});

const boot = async (spawn?: SpawnChatProcess): Promise<Daemon> => {
    const outbox = new OutboxStore(home);
    await outbox.load();
    const claude = inProcess(fakeClaude);
    const codex = inProcess(fakeCodex);
    const attachments = new AttachmentStore(home);
    // Declared before the chats, which ask it to owe a resume while they load.
    const box: { worker: OutboxWorker | null } = { worker: null };
    const chats = new ChatManager({
        providers,
        store: new ChatStore(home, attachments),
        attachments,
        spawn: spawn ?? ((options) => (options.command[0] === 'codex' ? codex.spawn(options) : claude.spawn(options))),
        env: { PATH: process.env.PATH, HOME: home },
        onInterruptedRun: oweResume({
            projectOf: (chatId) => projects.index.locate(chatId)?.projectId ?? null,
            entries: () => outbox.list(),
            enqueue: (projectId, target, work) => box.worker!.enqueue(projectId, target, work)
        })
    });
    const worker = new OutboxWorker({
        store: outbox,
        clock,
        handlers: {
            'deliver-message': () => Promise.reject(new Error('no messages in these tests')),
            'deliver-summary': () => Promise.reject(new Error('no summaries in these tests')),
            'deliver-waiting': () => Promise.reject(new Error('no waiting children in these tests')),
            'resume-limit': () => Promise.reject(new Error('no limits in these tests')),
            'give-task': () => Promise.reject(new Error('no tasks are given in these tests')),
            'start-agent': () => Promise.reject(new Error('no start in these tests')),
            'resume-run': resumeRunHandler(chats),
            'end-children': () => Promise.reject(new Error('no ending in these tests')),
            'wake-parent': () => Promise.reject(new Error('no wake in these tests'))
        },
        onParked: resumeRunParked(chats)
    });
    box.worker = worker;
    let waiters: Array<{ check: () => boolean; resolve: () => void }> = [];
    chats.observe(() => {
        const waiting = waiters;
        waiters = [];
        for (const waiter of waiting) {
            if (waiter.check()) {
                waiter.resolve();
            } else {
                waiters.push(waiter);
            }
        }
    });
    const daemon: Daemon = {
        chats,
        outbox,
        worker,
        claude,
        codex,
        until: (check) => (check() ? Promise.resolve() : new Promise((resolve) => waiters.push({ check, resolve }))),
        stop: async () => {
            worker.stop();
            // The order the daemon's own shutdown takes. Every thread down before anything is awaited.
            chats.persistAllSync();
            await chats.shutdown();
            for (const info of chats.list()) {
                chats.get(info.chatId)?.dispose();
            }
        }
    };
    running.push(daemon);
    return daemon;
};

/* The first daemon. The child is in the middle of a turn when it goes down. */
const interruptChild = async (provider: 'claude' | 'codex' = 'claude', chatId = 'chat-child'): Promise<{ turnId: string; agentSessionId: string }> => {
    const daemon = await boot();
    daemon.worker.start();
    await daemon.chats.create({ chatId, cwd: folder, provider });
    await daemon.chats.send(chatId, 'slow');
    const session = daemon.chats.get(chatId)!;
    await daemon.until(() => session.info.agentSessionId !== null);
    const turnId = session.info.activeTurnId!;
    const agentSessionId = session.info.agentSessionId!;
    running.splice(running.indexOf(daemon), 1);
    await daemon.stop();
    return { turnId, agentSessionId };
};

const turnOf = (daemon: Daemon, turnId: string, chatId = 'chat-child'): ChatItem | undefined => daemon.chats.get(chatId)?.thread.get(turnId);

describe('resume-run', () => {
    test('a child the daemon stopped in the middle of a turn goes on with --resume under the same turn, as its second attempt', async () => {
        const { turnId, agentSessionId } = await interruptChild();

        const daemon = await boot();
        daemon.worker.start();
        await daemon.chats.recoverInterrupted();
        await daemon.until(() => turnOf(daemon, turnId)?.kind === 'turn' && (turnOf(daemon, turnId) as { state: string }).state === 'done');
        await daemon.worker.settled();

        const session = daemon.chats.get('chat-child')!;
        expect(turnOf(daemon, turnId)).toMatchObject({ state: 'done', attempt: 2 });
        expect(session.info).toMatchObject({ status: 'idle', activeTurnId: null, agentSessionId });
        const argv = daemon.claude.started[0]!.argv;
        expect(argv[argv.indexOf('--resume') + 1]).toBe(agentSessionId);
        const items = session.thread.list();
        // No message of a person was made up. The prompt only went to the CLI, and the thread says why the turn went on.
        expect(items.filter((item) => item.kind === 'user').map((item) => (item.kind === 'user' ? item.text : ''))).toEqual(['slow']);
        expect(items.filter((item) => item.kind === 'turn')).toHaveLength(1);
        expect(items.find((item) => item.kind === 'note')).toMatchObject({ turnId, level: 'info', text: 'Resumed after the machine restarted' });
        expect(items.some((item) => item.kind === 'assistant' && item.turnId === turnId && item.text === `echo: ${RESUME_PROMPT}`)).toBe(true);
        expect(daemon.outbox.list()).toEqual([]);

        // Run again (a restart between the work and the removal of its entry), it starts nothing.
        await daemon.chats.resumeRun('chat-child', turnId, 2);
        expect(daemon.claude.started).toHaveLength(1);
    });

    test('a Codex child goes on in the same thread', async () => {
        const { turnId, agentSessionId } = await interruptChild('codex');

        const daemon = await boot();
        daemon.worker.start();
        await daemon.chats.recoverInterrupted();
        await daemon.until(() => turnOf(daemon, turnId)?.kind === 'turn' && (turnOf(daemon, turnId) as { state: string }).state === 'done');

        expect(turnOf(daemon, turnId)).toMatchObject({ state: 'done', attempt: 2 });
        // The fake hands a resumed thread its own id back and makes a new one for `thread/start`.
        expect(daemon.chats.get('chat-child')?.info.agentSessionId).toBe(agentSessionId);
        expect(daemon.codex.started).toHaveLength(1);
    });

    test('a chat that is a view of its own goes on after a restart like a chat on a canvas', async () => {
        const { turnId, agentSessionId } = await interruptChild('claude', 'chat-view');

        const daemon = await boot();
        daemon.worker.start();
        await daemon.chats.recoverInterrupted();
        await daemon.until(() => (turnOf(daemon, turnId, 'chat-view') as { state?: string } | undefined)?.state === 'done');
        await daemon.worker.settled();

        expect(turnOf(daemon, turnId, 'chat-view')).toMatchObject({ state: 'done', attempt: 2 });
        expect(daemon.chats.get('chat-view')?.info).toMatchObject({ status: 'idle', activeTurnId: null, agentSessionId });
        const argv = daemon.claude.started[0]!.argv;
        expect(argv[argv.indexOf('--resume') + 1]).toBe(agentSessionId);
        expect(daemon.outbox.list()).toEqual([]);
    });

    test('a resume that cannot be owed ends the turn aborted with the failure in its note', async () => {
        const { turnId } = await interruptChild();

        const daemon = await boot();
        daemon.worker.enqueue = () => Promise.reject(new Error('the outbox is not writable'));
        await daemon.chats.recoverInterrupted();

        expect(turnOf(daemon, turnId)).toMatchObject({ state: 'aborted' });
        expect(
            daemon.chats
                .get('chat-child')
                ?.thread.list()
                .find((item) => item.kind === 'note')
        ).toMatchObject({
            turnId,
            level: 'warning',
            text: 'This turn could not be resumed after the machine restarted: the outbox is not writable'
        });
        expect(daemon.claude.started).toHaveLength(0);
    });

    test('a resume whose CLI will not start is tried after 1, 5 and 30 seconds and then ends the turn with the reason', async () => {
        const { turnId } = await interruptChild();

        let spawns = 0;
        const daemon = await boot(() => {
            spawns += 1;
            throw new Error('claude is not installed');
        });
        daemon.worker.start();
        await daemon.chats.recoverInterrupted();
        await daemon.worker.settled();
        expect(spawns).toBe(1);
        expect(turnOf(daemon, turnId)).toMatchObject({ state: 'running' });

        for (const delay of RETRY_DELAYS_MS) {
            clock.advance(delay);
            await daemon.worker.settled();
        }
        expect(spawns).toBe(RETRY_DELAYS_MS.length + 1);
        expect(turnOf(daemon, turnId)).toMatchObject({ state: 'aborted' });
        const session = daemon.chats.get('chat-child')!;
        expect(session.info).toMatchObject({ status: 'idle', activeTurnId: null, running: false });
        expect(session.thread.list().find((item) => item.kind === 'note')).toMatchObject({
            turnId,
            level: 'warning',
            text: expect.stringContaining('could not be resumed after the machine restarted')
        });
        expect(daemon.outbox.list()).toEqual([]);
    });

    test('a turn that is not resumed ends aborted with a note that names the reason', async () => {
        const store = new ChatStore(home);
        const turn = (id: string, attempt?: number): ChatItem => ({
            id,
            kind: 'turn',
            createdAt: 1,
            turnId: id,
            state: 'running',
            origin: 'user',
            endedAt: null,
            costUsd: 0,
            attempt
        });
        const stored = (chatId: string, agentSessionId: string | null, items: ChatItem[]): { info: ChatInfo; items: ChatItem[] } => ({
            info: {
                chatId,
                provider: 'claude',
                cwd: folder,
                agentSessionId,
                model: null,
                selection: { model: 'claude-sonnet-5', options: {} },
                runtimeMode: 'full-access',
                status: 'running',
                running: true,
                activeTurnId: 'turn-1',
                slashCommands: [],
                usage: { contextTokens: 0, contextWindow: null, costUsd: 0, turns: 0 },
                createdAt: 1
            },
            items
        });
        const cases = [
            // An older running turn beside the active one is a record that was already broken; it ends too.
            { chatId: 'chat-child', record: stored('chat-child', 'session-1', [turn('turn-0'), turn('turn-1', 2)]) },
            { chatId: 'chat-elsewhere', record: stored('chat-elsewhere', 'session-1', [turn('turn-1')]) },
            { chatId: 'chat-view', record: stored('chat-view', null, [turn('turn-1')]) }
        ];
        for (const { chatId, record } of cases) {
            await store.write(chatId, record.info, record.items);
        }

        const daemon = await boot();
        await daemon.chats.recoverInterrupted();
        expect(daemon.outbox.list()).toEqual([]);
        const notesOf = (chatId: string): Array<{ turnId: string | null; level: string; text: string }> =>
            (daemon.chats.get(chatId)?.thread.list() ?? []).flatMap((item) =>
                item.kind === 'note' ? [{ turnId: item.turnId, level: item.level, text: item.text }] : []
            );
        const note = (turnId: string, reason: string) => ({
            turnId,
            level: 'warning',
            text: `This turn could not be resumed after the machine restarted: ${reason}`
        });
        expect(notesOf('chat-child')).toEqual([
            note('turn-0', 'it was not the turn the chat was running'),
            note('turn-1', 'it was already resumed after an earlier restart')
        ]);
        expect(notesOf('chat-elsewhere')).toEqual([note('turn-1', 'no project holds this chat any more')]);
        expect(notesOf('chat-view')).toEqual([note('turn-1', 'the agent had not started a session to resume yet')]);
        for (const { chatId } of cases) {
            expect(daemon.chats.get(chatId)?.thread.get('turn-1')).toMatchObject({ state: 'aborted' });
            expect(daemon.chats.get(chatId)?.info).toMatchObject({ status: 'idle', activeTurnId: null });
        }
        expect(daemon.chats.get('chat-child')?.thread.get('turn-0')).toMatchObject({ state: 'aborted' });
        expect(daemon.claude.started).toHaveLength(0);
    });

    test('stopping a turn that waits for its resume ends it, and the resume that comes later does nothing', async () => {
        const { turnId } = await interruptChild();

        const daemon = await boot();
        await daemon.chats.recoverInterrupted();
        expect(daemon.outbox.list()).toHaveLength(1);
        daemon.chats.cancel('chat-child');
        expect(turnOf(daemon, turnId)).toMatchObject({ state: 'aborted' });

        daemon.worker.start();
        await daemon.worker.settled();
        expect(daemon.claude.started).toHaveLength(0);
        expect(daemon.outbox.list()).toEqual([]);
    });
});
