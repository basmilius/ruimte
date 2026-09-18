import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatTurnItem, ProjectContent, Task } from '@ruimte/contracts';
import { nextLine } from '../canvas/task-verbs.ts';
import { ManualClock } from '../outbox/manual-clock.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, runVerb, type TestDaemon } from './test-daemon.ts';

type Daemon = TestDaemon;

/* A lead, a chat and a terminal of the person's own and a note: everything a task may not go to. */
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
                { id: 'chat-other', kind: 'chat', title: 'Notes of a person', x: 600, y: 0, w: 560, h: 640, provider: 'claude' },
                { id: 'term-own', kind: 'terminal', title: 'Shell', x: 0, y: 700, w: 560, h: 360 },
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
let running: Daemon[];

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-give-task-'));
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

const boot = async (): Promise<Daemon> => {
    const daemon = await bootTestDaemon({ home, store, clock });
    running.push(daemon);
    return daemon;
};

const verb = runVerb;

const turnsOf = (daemon: Daemon, chatId: string): ChatTurnItem[] =>
    (daemon.chats.get(chatId)?.thread.list() ?? []).filter((item): item is ChatTurnItem => item.kind === 'turn');

/* The turns a task opened or a wake opened, per task id, which is how a turn says what it is for. */
const turnsFor = (daemon: Daemon, chatId: string, taskId: string): ChatTurnItem[] =>
    turnsOf(daemon, chatId).filter((turn) => (turn.taskIds ?? []).includes(taskId));

/* The lead with a finished turn behind it, which is a chat a wake can open a turn in. */
const leadIdle = async (daemon: Daemon): Promise<void> => {
    await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
    await daemon.chats.send('chat-lead', 'plan the work');
    await daemon.until(() => turnsOf(daemon, 'chat-lead').some((turn) => turn.state === 'done'));
};

/* An agent the lead opens without a task, as a chat that is asked something later. */
const opened = async (daemon: Daemon, prompt: string, terminal = false): Promise<string> => {
    const [line] = await verb(daemon, 'chat-lead', 'agent', ['claude', ...(terminal ? ['--terminal'] : []), '--prompt', prompt]);
    const childId = line!.split('\t')[0]!;
    await daemon.until(() => (terminal ? daemon.sessions.get(childId) !== undefined : daemon.chats.get(childId) !== undefined));
    return childId;
};

/* The lines of `task new`, and the id of the task it opened. */
const give = async (daemon: Daemon, childId: string, argv: string[]): Promise<{ lines: string[]; taskId: string }> => {
    const lines = await verb(daemon, 'chat-lead', 'task', ['new', childId, ...argv]);
    return { lines, taskId: lines[0]!.split('\t')[1]! };
};

const taskOf = (daemon: Daemon, taskId: string): Task => daemon.tasks.get(taskId)!;

describe('a task given to an agent that is already open', () => {
    test('runs in a turn of its own and wakes the chat that gave it exactly once', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await leadIdle(daemon);
        const childId = await opened(daemon, 'look around');
        await daemon.until(() => turnsOf(daemon, childId).some((turn) => turn.state === 'done'));

        const { lines, taskId } = await give(daemon, childId, ['--prompt', 'check the note', '--title', 'The note']);
        expect(lines).toEqual([`task\t${taskId}\t${childId}\tnow`, nextLine(false)]);

        await daemon.until(() => taskOf(daemon, taskId).wake === 'sent');
        await daemon.worker.settled();

        // One turn in the child for the task, and one in the lead about its result.
        expect(turnsFor(daemon, childId, taskId)).toHaveLength(1);
        expect(turnsFor(daemon, 'chat-lead', taskId)).toHaveLength(1);
        const task = taskOf(daemon, taskId);
        expect([task.status, task.parentId, task.childId, task.title]).toEqual(['done', 'chat-lead', childId, 'The note']);
        expect(task.result?.text).toContain('echo: check the note');
        expect(turnsFor(daemon, 'chat-lead', taskId)[0]?.label).toBe('The note');
        // Nothing owed any more, so no second wake is waiting anywhere.
        expect(daemon.outbox.list()).toEqual([]);
    });

    test('waits for the turn the agent is in and settles on the turn it opens, never on the one in its way', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await leadIdle(daemon);
        // `slow` keeps the child's first turn open, the way a person's prompt waits for one that runs.
        const childId = await opened(daemon, 'slow');
        await daemon.until(() => daemon.chats.get(childId)?.info.activeTurnId !== null);

        const { lines, taskId } = await give(daemon, childId, ['--prompt', 'check the note']);
        expect(lines[0]).toBe(`task\t${taskId}\t${childId}\twaiting`);
        expect(daemon.outbox.list().map((entry) => entry.kind)).toEqual(['give-task']);
        expect(taskOf(daemon, taskId).status).toBe('open');

        // The turn it was in ends without an answer; that is not the task's result.
        daemon.chats.cancel(childId);
        await daemon.until(() => taskOf(daemon, taskId).wake === 'sent');
        await daemon.worker.settled();

        const task = taskOf(daemon, taskId);
        expect(task.status).toBe('done');
        expect(task.result?.text).toContain('echo: check the note');
        expect(turnsFor(daemon, childId, taskId)).toHaveLength(1);
        expect(turnsFor(daemon, 'chat-lead', taskId)).toHaveLength(1);
    });

    test('is refused while that agent still works on one, naming the task in its way', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await leadIdle(daemon);
        const childId = await opened(daemon, 'slow');
        await daemon.until(() => daemon.chats.get(childId)?.info.activeTurnId !== null);
        const { taskId } = await give(daemon, childId, ['--prompt', 'check the note', '--title', 'The note']);

        const refused = await verb(daemon, 'chat-lead', 'task', ['new', childId, '--prompt', 'and the other one']);
        expect(refused[0]).toBe(
            `refused\ttask-running\t${childId} is working on the task "The note" and takes one at a time; wait for its result, which wakes you`
        );
        expect(refused[1]).toContain(taskId);
        // Nothing was written for the second call: one agent holds one task.
        expect(daemon.tasks.involving(childId)).toHaveLength(1);
    });

    test('is refused for an agent the caller did not open, whichever lines run between them', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await leadIdle(daemon);
        await verb(daemon, 'chat-lead', 'link', ['new', '--to', 'chat-other']);

        const refused = await verb(daemon, 'chat-lead', 'task', ['new', 'chat-other', '--prompt', 'check the note']);
        expect(refused[0]).toBe('refused\tnot-yours\tchat-other is not a node you opened; a task only goes to an agent you opened yourself');
        expect(daemon.tasks.involving('chat-other')).toEqual([]);
        expect(daemon.outbox.list()).toEqual([]);
    });

    test('is refused for a node that runs no agent at all', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await leadIdle(daemon);

        const refused = await verb(daemon, 'chat-lead', 'task', ['new', 'note-1', '--prompt', 'check the note']);
        expect(refused[0]).toBe('refused\tnot-an-agent\tnote-1 is a note node; only a terminal or a chat has an agent that could take a task');
        expect(daemon.tasks.involving('note-1')).toEqual([]);
    });

    test('is refused for a terminal it opened, since nothing is typed into a shell', async () => {
        const daemon = await boot();
        daemon.worker.start();
        await leadIdle(daemon);
        const childId = await opened(daemon, 'look around', true);

        const refused = await verb(daemon, 'chat-lead', 'task', ['new', childId, '--prompt', 'check the note']);
        expect(refused[0]).toBe(
            `refused\tnot-a-chat\t${childId} is a terminal node: a task has to start a turn, and nothing is typed into a shell a person can type in`
        );
        expect(daemon.tasks.involving(childId)).toEqual([]);
    });

    test('is refused for a node whose agent the machine has not started yet', async () => {
        const daemon = await boot();
        await leadIdle(daemon);
        // The worker is not running, so the node is on the canvas while its start is still owed.
        const [line] = await verb(daemon, 'chat-lead', 'agent', ['claude', '--prompt', 'look around']);
        const childId = line!.split('\t')[0]!;
        expect(daemon.chats.get(childId)).toBeUndefined();

        const refused = await verb(daemon, 'chat-lead', 'task', ['new', childId, '--prompt', 'check the note']);
        expect(refused[0]).toBe(`refused\tno-agent\t${childId} runs no agent yet: nothing was started in it, so there is no turn a task could open`);
        expect(daemon.tasks.involving(childId)).toEqual([]);
    });
});
