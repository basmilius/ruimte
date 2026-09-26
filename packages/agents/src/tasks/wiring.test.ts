import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { ChatTurnItem, Task } from '@ruimte/agent-contracts';
import { fakeClaude } from '../chat/fake-claude.ts';
import { inProcess } from '../chat/fake-cli.ts';
import { AgentHost } from '../host/agent-host.ts';
import { ManualClock } from '../outbox/manual-clock.ts';
import { OutboxStore } from '../outbox/outbox.ts';
import { OutboxWorker } from '../outbox/outbox-worker.ts';
import { TaskStore } from './task-store.ts';
import { BackgroundLimitWorkSchema, DeliverWaitingWorkSchema, GiveTaskWorkSchema, WakeParentWorkSchema, type TaskWork } from './task-work.ts';
import { wireTasks, type TaskWiring } from './wiring.ts';

// An app with chats and nothing else: the outbox owes only what tasks owe.
const WorkSchema = z.discriminatedUnion('kind', [BackgroundLimitWorkSchema, WakeParentWorkSchema, GiveTaskWorkSchema, DeliverWaitingWorkSchema]);

let dataDir: string;
let host: AgentHost;
let tasks: TaskStore;
let worker: OutboxWorker<TaskWork>;
let wiring: TaskWiring;
let changed: Task[];
let watchers: Array<{ check(): boolean; resolve(): void }>;

/* Settles once `check` holds, looked at after every chat event and every task written; no clock is involved. */
const until = (check: () => boolean): Promise<void> => {
    if (check()) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        watchers.push({ check, resolve });
    });
};

const look = (): void => {
    for (const watcher of [...watchers]) {
        if (watcher.check()) {
            watchers.splice(watchers.indexOf(watcher), 1);
            watcher.resolve();
        }
    }
};

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'agents-tasks-'));
    const claude = inProcess(fakeClaude);
    host = await AgentHost.open({ dataDir, env: { HOME: dataDir, PATH: process.env.PATH }, background: false, command: ['claude'], spawn: claude.spawn });
    tasks = new TaskStore(dataDir);
    await tasks.load();
    const outbox = new OutboxStore<TaskWork>({ dataDir, work: WorkSchema });
    await outbox.load();
    const clock = new ManualClock();
    changed = [];
    watchers = [];
    wiring = wireTasks({
        tasks,
        chats: host.chats,
        outbox: {
            list: () => outbox.list(),
            enqueue: (projectId, target, work, notBefore) => worker.enqueue(projectId, target, work, notBefore),
            remove: (id) => outbox.remove(id),
            wake: (target) => worker.wake(target)
        },
        placed: () => true,
        titleFor: (nodeId) => (nodeId === 'lead' ? 'Lead' : null),
        alert: () => undefined,
        changed: (task) => changed.push(task),
        words: { app: 'Motion', cli: 'motion-context' },
        now: () => clock.now()
    });
    worker = new OutboxWorker({ store: outbox, clock, handlers: wiring.handlers, onParked: (entry, error) => wiring.onParked(entry, error) });
    worker.start();
    host.chats.observe(() => queueMicrotask(look));
    tasks.onChange(() => queueMicrotask(look));
    await host.chats.create({ chatId: 'lead', provider: 'claude', cwd: dataDir });
    await host.chats.create({ chatId: 'child', provider: 'claude', cwd: dataDir });
});

afterEach(async () => {
    wiring.coordinator.stop();
    wiring.waiting.stop();
    worker.stop();
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
});

const turnsOf = (chatId: string): ChatTurnItem[] => (host.chats.get(chatId)?.thread.list() ?? []).filter((item): item is ChatTurnItem => item.kind === 'turn');

test('a chat child settles its task on the end of its turn, and the parent is woken once with the result', async () => {
    const task = await wiring.verbs.open({ projectId: 'project', parentId: 'lead', childId: 'child', title: 'Lexer', prompt: 'fix the lexer' });
    await host.chats.send('child', 'fix the lexer');

    await until(() => turnsOf('lead').some((turn) => turn.state === 'done' && (turn.taskIds ?? []).includes(task.id)));
    await worker.settled();
    expect(tasks.get(task.id)).toMatchObject({ status: 'done', result: { text: 'echo: fix the lexer', source: 'turn' }, wake: 'sent' });
    expect(turnsOf('lead')).toHaveLength(1);
    // The fake CLI echoes what it was sent, which is the prompt the wake gave it.
    const heard = host.chats
        .get('lead')!
        .thread.list()
        .find((item) => item.kind === 'assistant');
    expect(heard?.kind === 'assistant' ? heard.text : '').toStartWith(
        `echo: A task you gave has settled. Its result:\n\n## Lexer (node child, task ${task.id}): done`
    );
    expect(changed.map((written) => [written.status, written.wake])).toEqual([
        ['open', 'pending'],
        ['done', 'pending'],
        ['done', 'sent']
    ]);
    expect(await wiring.verbs.chatState('child')).toBe('idle');
    expect(wiring.verbs.involving('lead').map((listed) => listed.id)).toEqual([task.id]);
});

test('a task given to a running chat opens a turn of its own that names it, with the note of who asked', async () => {
    await host.chats.send('child', 'hello');
    await until(() => turnsOf('child').some((turn) => turn.state === 'done'));
    const task = await wiring.verbs.give({ projectId: 'project', parentId: 'lead', childId: 'child', title: 'Docs', prompt: 'write the docs' });

    await until(() => tasks.get(task.id)?.wake === 'sent');
    await worker.settled();
    const own = turnsOf('child').find((turn) => (turn.taskIds ?? []).includes(task.id));
    expect(own).toMatchObject({ state: 'done' });
    expect(
        host.chats
            .get('child')!
            .thread.list()
            .some((item) => item.kind === 'note' && item.text === 'Task from Lead')
    ).toBe(true);
    expect(tasks.get(task.id)).toMatchObject({ status: 'done', result: { text: 'echo: write the docs' } });
});

test('done from the child wins, and an agent that is not a chat fails its task when the host says it ended', async () => {
    const task = await wiring.verbs.open({ projectId: 'project', parentId: 'lead', childId: 'child', title: 'Lexer', prompt: 'fix it' });
    expect(await wiring.verbs.done('child', 'fixed it myself')).toMatchObject({ status: 'done', result: { text: 'fixed it myself', source: 'done' } });
    await until(() => tasks.get(task.id)?.wake === 'sent');

    const other = await wiring.verbs.open({ projectId: 'project', parentId: 'lead', childId: 'shell-1', title: 'Build', prompt: 'build it' });
    wiring.coordinator.agentEnded('shell-1', 'It ended without calling done.');
    await until(() => tasks.get(other.id)?.status === 'failed');
    expect(tasks.get(other.id)?.result).toMatchObject({ text: 'It ended without calling done.', source: 'exit' });
    await until(() => tasks.get(other.id)?.wake === 'sent');
    await worker.settled();
});
