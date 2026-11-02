import { beforeEach, expect, test } from 'bun:test';
import type { Task } from '@ruimte/contracts';
import { TaskCoordinator, TaskStore } from '@adecore/agents/coordination';
import { terminalTasks, type TerminalTasks } from './terminal-tasks.ts';
import { tempHomes } from '../temp-home-test-helpers.ts';

let home: string;
let tasks: TaskStore;
let coordinator: TaskCoordinator;
let terminals: TerminalTasks;
let owed: Promise<void>;
let onOwed: () => void;

const newHome = tempHomes('ruimte-terminal-tasks-');

beforeEach(async () => {
    home = await newHome();
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

function open(): Promise<Task> {
    return tasks.open({ projectId: 'p', parentId: 'chat-lead', childId: 'terminal-child', title: 'Lexer', prompt: 'go' }, 1);
}

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
        result: { text: 'It ended without a result: a terminal reports back with task_done.', source: 'exit' }
    });
});
