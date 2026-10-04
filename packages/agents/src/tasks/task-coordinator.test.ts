import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { notResumedNote, type ChatBackgroundTask, type ChatItem, type ChatTurnItem, type Task } from '@ruimte/agent-contracts';
import type { AgentEvent } from '../events.ts';
import { writeAtomic } from '../fs.ts';
import { TaskCoordinator, resultOfTurn } from './task-coordinator.ts';
import { TaskStore } from './task-store.ts';

let home: string;
let tasks: TaskStore;
let threads: Map<string, ChatItem[]>;
let owed: string[];
let onOwed: (() => void) | null;
let coordinator: TaskCoordinator;
let after: 'reports' | 'silent' | 'gone';
let commands: Map<string, ChatBackgroundTask[]>;
let limits: Map<string, { commands: readonly string[]; at: number }>;

function makeCoordinator(): TaskCoordinator {
    return new TaskCoordinator({
        tasks,
        now: () => 10,
        chatItems: (chatId) => threads.get(chatId) ?? null,
        placed: () => true,
        // These tasks were opened with their children, so no separate assignment turn is owed.
        owedTurn: () => false,
        oweWake: async (task) => {
            owed.push(task.id);
            onOwed?.();
        },
        alert: () => undefined,
        afterBackgroundWork: () => after,
        commandsOf: (chatId) => commands.get(chatId) ?? [],
        limit: {
            owed: (taskId) => limits.has(taskId),
            owe: async (task, list, at) => {
                limits.set(task.id, { commands: list, at });
            },
            lapse: async (taskId) => {
                limits.delete(taskId);
            }
        }
    });
}

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-task-coordinator-'));
    tasks = new TaskStore(home);
    threads = new Map();
    owed = [];
    onOwed = null;
    after = 'reports';
    commands = new Map();
    limits = new Map();
    coordinator = makeCoordinator();
});

afterEach(async () => {
    coordinator.stop();
    await coordinator.settled();
    await rm(home, { recursive: true, force: true });
});

function turn(id: string, state: ChatTurnItem['state']): ChatTurnItem {
    return { id, kind: 'turn', createdAt: 5, turnId: id, state, endedAt: 9, costUsd: 0 };
}

function answer(turnId: string, text: string, parentToolUseId?: string): ChatItem {
    return {
        id: `a-${turnId}-${text}`,
        kind: 'assistant',
        createdAt: 6,
        turnId,
        text,
        streaming: false,
        ...(parentToolUseId ? { parentToolUseId } : {})
    };
}

function workflow(state: 'running' | 'done' | 'error'): ChatItem {
    return {
        id: 'wf',
        kind: 'tool',
        createdAt: 6,
        turnId: 't1',
        toolUseId: 'toolu_wf',
        name: 'Workflow',
        input: {},
        output: 'Workflow launched in background. Task ID: w1',
        state,
        parentToolUseId: null
    };
}

/* The events a chat sends as a turn of it ends: the settled turn, then the info that frees it. */
function ends(chatId: string, item: ChatTurnItem): void {
    coordinator.chatEvent({ event: 'chat.event', payload: { chatId, event: { type: 'item', item } } });
    // Only `activeTurnId` of the info is read, so the rest of it is left out.
    coordinator.chatEvent({ event: 'chat.event', payload: { chatId, event: { type: 'info', info: { activeTurnId: null } } } } as unknown as AgentEvent);
}

function open(parentId: string, childId: string): Promise<Task> {
    return tasks.open({ projectId: 'p', parentId, childId, title: childId, prompt: 'go' }, 1);
}

/* Resolves once the next wake is owed, which is after the settled task is on disk. */
function nextOwed(): Promise<void> {
    return new Promise((resolve) => {
        onOwed = resolve;
    });
}

describe('the result of a turn', () => {
    test('is the last answer of the child itself, not of a subagent it ran', () => {
        const items = [answer('t', 'first'), answer('t', 'last'), answer('t', 'from a subagent', 'toolu_1')];
        expect(resultOfTurn(turn('t', 'done'), items, 3)).toEqual({ status: 'done', result: { text: 'last', source: 'turn', at: 3 } });
    });

    test('a turn a person stopped or the machine ended fails the task and says which', () => {
        const note: ChatItem = { id: 'n', kind: 'note', createdAt: 7, turnId: 't', level: 'warning', text: notResumedNote('no session') };
        expect(resultOfTurn(turn('t', 'aborted'), [], 3).result.text).toBe('It was stopped before it finished.');
        expect(resultOfTurn(turn('t', 'aborted'), [note], 3)).toMatchObject({ status: 'failed', result: { text: notResumedNote('no session') } });
        expect(resultOfTurn(turn('t', 'error'), [], 3).status).toBe('failed');
    });
});

describe('the coordinator', () => {
    test('shutdown waits for the result wake even when the task record is already settled', async () => {
        const wake = Promise.withResolvers<void>();
        const waiting = Promise.withResolvers<void>();
        coordinator = new TaskCoordinator({
            tasks,
            now: () => 10,
            chatItems: (chatId) => threads.get(chatId) ?? null,
            placed: () => true,
            owedTurn: () => false,
            oweWake: async (task) => {
                waiting.resolve();
                await wake.promise;
                owed.push(task.id);
            },
            alert: () => undefined,
            afterBackgroundWork: () => 'gone',
            commandsOf: () => [],
            limit: { owed: () => false, owe: async () => undefined, lapse: async () => undefined }
        });
        const task = await open('parent', 'child');
        threads.set('child', [turn('t1', 'done'), answer('t1', 'finished')]);
        ends('child', turn('t1', 'done'));
        await waiting.promise;
        expect(tasks.get(task.id)?.status).toBe('done');
        coordinator.stop();
        let shutDown = false;
        const stopped = coordinator.settled().then(() => {
            shutDown = true;
        });
        await Promise.resolve();
        expect(shutDown).toBe(false);
        expect(owed).toEqual([]);
        wake.resolve();
        await stopped;
        expect(owed).toEqual([task.id]);
    });

    test('a new assignment ignores an old turn during a blocked task write', async () => {
        const gate = Promise.withResolvers<void>();
        const writing = Promise.withResolvers<void>();
        tasks = new TaskStore(home, {
            write: async (path, text) => {
                writing.resolve();
                await gate.promise;
                await writeAtomic(path, text);
            }
        });
        coordinator = makeCoordinator();
        const opening = tasks.open({ projectId: 'p', parentId: 'parent', childId: 'child', title: 'new', prompt: 'new work', requiresTaskTurn: true }, 10);
        const task = tasks.openFor('child')!;
        await writing.promise;
        threads.set('child', [turn('old', 'done'), answer('old', 'old answer')]);
        ends('child', turn('old', 'done'));
        expect(tasks.get(task.id)?.status).toBe('open');
        gate.resolve();
        await opening;
        expect(tasks.get(task.id)?.status).toBe('open');
        const own = { ...turn('own', 'done'), createdAt: 11, taskIds: [task.id] };
        threads.set('child', [turn('old', 'done'), own, answer('own', 'new answer')]);
        const woken = nextOwed();
        ends('child', own);
        await woken;
        expect(tasks.get(task.id)?.result?.text).toBe('new answer');
    });

    test('a background workflow lost at restart fails instead of returning its launch answer', async () => {
        const task = await open('parent', 'child');
        threads.set('child', [turn('t1', 'done'), workflow('running'), answer('t1', 'I launched it')]);
        ends('child', turn('t1', 'done'));
        // The next write waits behind the hold record, so the new store reads the durable state.
        await tasks.pause(task.id, { kind: 'usage' });
        tasks = new TaskStore(home);
        await tasks.load();
        coordinator = makeCoordinator();
        after = 'gone';
        threads.set('child', [turn('t1', 'done'), workflow('error'), answer('t1', 'I launched it')]);
        const woken = nextOwed();
        ends('child', turn('t1', 'done'));
        await woken;
        expect(tasks.get(task.id)).toMatchObject({ status: 'failed', result: { source: 'exit' } });
        expect(tasks.get(task.id)?.result?.text).toContain('background');
        expect(owed).toEqual([task.id]);
    });

    test('settles a chat child on the end of its turn and owes its parent a wake', async () => {
        const task = await open('chat-lead', 'chat-child');
        threads.set('chat-child', [turn('t1', 'done'), answer('t1', 'fixed')]);
        const owedOnce = nextOwed();
        ends('chat-child', turn('t1', 'done'));
        await owedOnce;
        expect(tasks.get(task.id)).toMatchObject({ status: 'done', result: { text: 'fixed', source: 'turn' } });
        expect(owed).toEqual([task.id]);
    });

    test('a child that delegated in its turn settles only once its own tasks settled and woke it', async () => {
        const task = await open('chat-lead', 'chat-child');
        const grandchild = await open('chat-child', 'chat-grandchild');
        threads.set('chat-child', [turn('t1', 'done'), answer('t1', 'I asked a helper')]);
        // Decided in the event itself: a settle is in memory before its write, so open here is open.
        ends('chat-child', turn('t1', 'done'));
        expect(tasks.get(task.id)?.status).toBe('open');

        // The helper finishes; its wake is still owed, so the child is not done yet either.
        threads.set('chat-grandchild', [turn('g1', 'done'), answer('g1', 'helped')]);
        const helped = nextOwed();
        ends('chat-grandchild', turn('g1', 'done'));
        await helped;
        expect(tasks.get(grandchild.id)?.status).toBe('done');
        ends('chat-child', turn('t1', 'done'));
        expect(tasks.get(task.id)?.status).toBe('open');

        // The wake went out and the child's turn about it ended: that answer is the result.
        await tasks.markWoken([grandchild.id]);
        threads.set('chat-child', [turn('t1', 'done'), answer('t1', 'I asked a helper'), turn('t2', 'done'), answer('t2', 'all done')]);
        // Awaited so the wake lands in this test and not in the list of the next one.
        const settled = nextOwed();
        ends('chat-child', turn('t2', 'done'));
        expect(tasks.get(task.id)).toMatchObject({ status: 'done', result: { text: 'all done' } });
        await settled;
    });

    test('done wins over the end of the turn it was called in, and nothing settles a task twice', async () => {
        const task = await open('chat-lead', 'chat-child');
        expect(await coordinator.done('chat-child', 'explicit')).toMatchObject({ status: 'done', result: { source: 'done' } });
        threads.set('chat-child', [turn('t1', 'done'), answer('t1', 'implicit')]);
        ends('chat-child', turn('t1', 'done'));
        expect(tasks.get(task.id)?.result?.text).toBe('explicit');
        expect(owed).toEqual([task.id]);
        expect(await coordinator.done('chat-child', 'again')).toBeNull();
    });

    test('a turn that ended with a workflow running settles nothing; the work ending settles on that turn when the CLI says no more', async () => {
        const task = await open('chat-lead', 'chat-child');
        after = 'silent';
        const launched = workflow('running');
        threads.set('chat-child', [turn('t1', 'done'), launched, answer('t1', 'waiting for the workflow')]);
        ends('chat-child', turn('t1', 'done'));
        expect(tasks.get(task.id)?.status).toBe('open');

        const finished = workflow('done');
        threads.set('chat-child', [turn('t1', 'done'), finished, answer('t1', 'waiting for the workflow')]);
        const owedOnce = nextOwed();
        coordinator.chatEvent({ event: 'chat.event', payload: { chatId: 'chat-child', event: { type: 'item', item: finished } } });
        await owedOnce;
        expect(tasks.get(task.id)).toMatchObject({ status: 'done', result: { text: 'waiting for the workflow', source: 'turn' } });
    });

    test('background work that ended with the process fails the task, and a CLI that reports on it holds the task for that turn', async () => {
        const task = await open('chat-lead', 'chat-child');
        threads.set('chat-child', [turn('t1', 'done'), workflow('running'), answer('t1', 'launched')]);
        ends('chat-child', turn('t1', 'done'));

        const failed = workflow('error');
        threads.set('chat-child', [turn('t1', 'done'), failed, answer('t1', 'launched')]);
        coordinator.chatEvent({ event: 'chat.event', payload: { chatId: 'chat-child', event: { type: 'item', item: failed } } });
        expect(tasks.get(task.id)?.status).toBe('open');

        after = 'gone';
        const owedOnce = nextOwed();
        coordinator.chatEvent({ event: 'chat.event', payload: { chatId: 'chat-child', event: { type: 'item', item: failed } } });
        await owedOnce;
        expect(tasks.get(task.id)).toMatchObject({ status: 'failed', result: { source: 'exit' } });
    });

    test('a command left in the background holds the task and owes its limit once; the limit settles it on that turn, saying what still ran', async () => {
        const task = await open('chat-lead', 'chat-child');
        commands.set('chat-child', [{ id: 'b1', kind: 'shell', description: 'Serve', command: 'bun dev', startedAt: 8 }]);
        threads.set('chat-child', [turn('t1', 'done'), answer('t1', 'the server runs')]);
        ends('chat-child', turn('t1', 'done'));
        ends('chat-child', turn('t1', 'done'));
        expect(tasks.get(task.id)?.status).toBe('open');
        expect([...limits]).toEqual([[task.id, { commands: ['bun dev'], at: 10 + 30 * 60_000 }]]);

        const owedOnce = nextOwed();
        await coordinator.outlasted('chat-child', ['bun dev']);
        await owedOnce;
        expect(tasks.get(task.id)).toMatchObject({
            status: 'done',
            result: { text: 'the server runs\n\nThe task settled after 30 minutes while this still ran in the background: `bun dev`.', source: 'turn' }
        });
        expect(await coordinator.outlasted('chat-child', ['bun dev'])).toBeNull();
        expect(owed).toEqual([task.id]);
    });

    test('a subagent beside a command holds the task with no limit, and the limit starts once the command is all that is left', async () => {
        const task = await open('chat-lead', 'chat-child');
        limits.set(task.id, { commands: ['bun dev'], at: 1 });
        commands.set('chat-child', [{ id: 'b1', kind: 'shell', description: 'Serve', command: 'bun dev', startedAt: 8 }]);
        threads.set('chat-child', [turn('t1', 'done'), workflow('running'), answer('t1', 'working')]);
        ends('chat-child', turn('t1', 'done'));
        await Promise.resolve();
        expect(tasks.get(task.id)?.status).toBe('open');
        expect(limits.size).toBe(0);

        const finished = workflow('done');
        threads.set('chat-child', [turn('t1', 'done'), finished, answer('t1', 'working')]);
        coordinator.chatEvent({ event: 'chat.event', payload: { chatId: 'chat-child', event: { type: 'item', item: finished } } });
        expect(tasks.get(task.id)?.status).toBe('open');
        expect(limits.get(task.id)?.at).toBe(10 + 30 * 60_000);
    });

    test('an agent that is not a chat fails its task when it ends without done', async () => {
        const task = await open('chat-lead', 'terminal-child');
        const owedOnce = nextOwed();
        coordinator.agentEnded('terminal-child', 'It ended without a result.');
        await owedOnce;
        expect(tasks.get(task.id)).toMatchObject({ status: 'failed', result: { text: 'It ended without a result.', source: 'exit' } });
    });

    test('nothing that dies with the host settles a task', async () => {
        const task = await open('chat-lead', 'terminal-child');
        coordinator.stop();
        coordinator.agentEnded('terminal-child', 'It ended without a result.');
        expect(tasks.get(task.id)?.status).toBe('open');
    });
});

describe('the task store', () => {
    test('a removed child cancels its open task and a removed parent takes its tasks, across a restart', async () => {
        const kept = await open('chat-lead', 'chat-a');
        const gone = await open('chat-lead', 'chat-b');
        const orphan = await open('chat-other', 'chat-c');
        const cancelled = await tasks.prune('p', new Set(['chat-lead', 'chat-a', 'chat-c']), 5);
        expect(cancelled.map((task) => task.id)).toEqual([gone.id]);
        const reloaded = new TaskStore(home);
        await reloaded.load();
        expect(reloaded.get(kept.id)?.status).toBe('open');
        expect(reloaded.get(gone.id)).toMatchObject({ status: 'cancelled', wake: 'none' });
        expect(reloaded.get(orphan.id)).toBeUndefined();
    });
});
