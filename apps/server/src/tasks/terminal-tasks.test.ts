import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Task } from '@ruimte/contracts';
import { TaskCoordinator } from '@ruimte/agents/tasks/task-coordinator';
import { TaskStore } from '@ruimte/agents/tasks/task-store';
import { terminalTasks, type TerminalTasks } from './terminal-tasks.ts';

let home: string;
let tasks: TaskStore;
let coordinator: TaskCoordinator;
let terminals: TerminalTasks;
let owed: Promise<void>;
let onOwed: () => void;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-terminal-tasks-'));
    tasks = new TaskStore(home);
    owed = new Promise((resolve) => {
        onOwed = resolve;
    });
    coordinator = new TaskCoordinator({
        tasks,
        now: () => 10,
        chatItems: () => null,
        placed: () => true,
        owedTurn: () => false,
        oweWake: async () => onOwed(),
        alert: () => undefined,
        afterBackgroundWork: () => 'gone',
        commandsOf: () => [],
        limit: { owed: () => false, owe: async () => undefined, lapse: async () => undefined }
    });
    terminals = terminalTasks(coordinator);
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

const open = (): Promise<Task> => tasks.open({ projectId: 'p', parentId: 'chat-lead', childId: 'terminal-child', title: 'Lexer', prompt: 'go' }, 1);

test('a terminal agent that says goodbye without done fails its task, saying how a terminal reports back', async () => {
    const task = await open();
    terminals.sessionEvent({
        event: 'session.status',
        payload: {
            sessionId: 'terminal-child',
            agent: { kind: 'claude', agentSessionId: 'cli', transcriptPath: null, status: 'exited', live: true, updatedAt: 9 }
        }
    });
    await owed;
    expect(tasks.get(task.id)).toMatchObject({
        status: 'failed',
        result: { text: 'It ended without a result: a terminal reports back with ruimte-context done.', source: 'exit' }
    });
});

test('nothing that dies with the daemon settles a task', async () => {
    const task = await open();
    coordinator.stop();
    terminals.ended('terminal-child');
    expect(tasks.get(task.id)?.status).toBe('open');
});
