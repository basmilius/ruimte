import { describe, expect, test } from 'bun:test';
import type { ChatItem, Task } from '@ruimte/agent-contracts';
import type { WakeChat } from '../chat/wake-chat.ts';
import type { WakeParentEntry } from './task-work.ts';
import { RESULT_PREVIEW_BYTES, wakeParentHandler, wakePrompt } from './wake-parent.ts';

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
    id,
    projectId: 'project',
    parentId: 'chat-lead',
    childId: `chat-${id}`,
    title: `Title ${id}`,
    prompt: 'do it',
    status: 'done',
    result: { text: `result of ${id}`, source: 'turn', at: 1 },
    createdAt: 1,
    settledAt: 2,
    wake: 'pending',
    ...overrides
});

const entry: WakeParentEntry = {
    kind: 'wake-parent',
    payload: { taskId: 'a' },
    id: 'wake-parent-1',
    projectId: 'project',
    target: 'chat-lead',
    createdAt: 1,
    attempts: 0,
    notBefore: 1
};

/* A task store as the handler reads it, and a chat that says whether a turn is in its way. */
const fixture = (tasks: Task[], chat: { items?: ChatItem[]; busy?: boolean } | null) => {
    const woken: string[][] = [];
    const marked: string[] = [];
    const dropped: string[] = [];
    const wake: WakeChat | null =
        chat === null
            ? null
            : {
                  items: () => chat.items ?? [],
                  wake: (request) => {
                      if (chat.busy === true) {
                          return false;
                      }
                      woken.push(request.taskIds);
                      return true;
                  }
              };
    const openBatches = (): string[] => [
        ...new Set(tasks.flatMap((candidate) => (candidate.status === 'open' && candidate.batchId !== undefined ? [candidate.batchId] : [])))
    ];
    const handler = wakeParentHandler({
        tasks: {
            pendingWake: () => tasks.filter((candidate) => candidate.status !== 'open' && candidate.wake === 'pending'),
            readyWake: () =>
                tasks.filter((candidate) => candidate.status !== 'open' && candidate.wake === 'pending' && !openBatches().includes(candidate.batchId ?? '')),
            openBatches: () => openBatches(),
            markWoken: async (ids) => {
                marked.push(...ids);
                for (const candidate of tasks) {
                    if (ids.includes(candidate.id)) {
                        candidate.wake = 'sent';
                    }
                }
            },
            dropWake: async (parentId) => {
                dropped.push(parentId);
            }
        },
        chat: async () => wake
    });
    return { handler, woken, marked, dropped };
};

describe('wake-parent', () => {
    test('takes every settled task that has not woken the chat, in one turn, and leaves the open ones', async () => {
        const { handler, woken, marked } = fixture([task('a'), task('b', { status: 'failed' }), task('c', { status: 'open', result: null })], {});
        expect(await handler(entry)).toBeUndefined();
        expect(woken).toEqual([['a', 'b']]);
        expect(marked).toEqual(['a', 'b']);
        // A second entry for the same chat finds nothing left.
        expect(await handler(entry)).toBeUndefined();
        expect(woken).toHaveLength(1);
    });

    test('holds a team whose other tasks are open and waits, while a single task beside it goes out', async () => {
        const tasks = [task('a', { batchId: 'batch-1' }), task('b', { batchId: 'batch-1', status: 'open', result: null }), task('c')];
        const { handler, woken } = fixture(tasks, {});
        expect(await handler(entry)).toBe('wait');
        expect(woken).toEqual([['c']]);
        expect(await handler(entry)).toBe('wait');
        expect(woken).toHaveLength(1);

        tasks[1]!.status = 'cancelled';
        tasks[1]!.wake = 'none';
        expect(await handler(entry)).toBeUndefined();
        expect(woken).toEqual([['c'], ['a']]);
    });

    test('waits for a chat in a turn, without marking anything', async () => {
        const { handler, woken, marked } = fixture([task('a')], { busy: true });
        expect(await handler(entry)).toBe('wait');
        expect([woken, marked]).toEqual([[], []]);
    });

    test('a task a turn of the thread already names is marked without a second turn, which is a restart between the two', async () => {
        const turn: ChatItem = { id: 't', kind: 'turn', createdAt: 1, turnId: 't', state: 'done', origin: 'agent', taskIds: ['a'], endedAt: 2, costUsd: 0 };
        const { handler, woken, marked } = fixture([task('a'), task('b')], { items: [turn] });
        await handler(entry);
        expect(marked).toEqual(['a', 'b']);
        expect(woken).toEqual([['b']]);
    });

    test('a chat with no thread any more stops its tasks from waiting', async () => {
        const { handler, dropped } = fixture([task('a')], null);
        await handler(entry);
        expect(dropped).toEqual(['chat-lead']);
    });

    test('a long result is cut at a character boundary with the way to the rest', () => {
        const text = `${'é'.repeat(RESULT_PREVIEW_BYTES)}`;
        const tasks = [task('a', { result: { text, source: 'done', at: 1 } })];
        const prompt = wakePrompt(tasks, 0, (childId) => `read ${childId} for the rest.`);
        expect(prompt).toStartWith('A task you gave has settled. Its result:\n\n## Title a (node chat-a, task a): done');
        expect(prompt).toContain('é'.repeat(RESULT_PREVIEW_BYTES / 2));
        expect(prompt).not.toContain('�');
        expect(prompt).toEndWith('\n\n[The result was cut at 8 KiB. read chat-a for the rest.]');
        expect(wakePrompt(tasks)).toEndWith('\n\n[The result was cut at 8 KiB.]');
    });
});

test('a wake is marked only after its parent turn is durably saved, including a failed save and retry', async () => {
    const candidate = task('durable');
    const items: ChatItem[] = [];
    const saved = Promise.withResolvers<void>();
    let fail = true;
    let turns = 0;
    const handler = wakeParentHandler({
        tasks: {
            pendingWake: () => (candidate.wake === 'pending' ? [candidate] : []),
            readyWake: () => [candidate],
            openBatches: () => [],
            markWoken: async () => {
                candidate.wake = 'sent';
            },
            dropWake: async () => undefined
        },
        chat: async () => ({
            items: () => items,
            wake: (wake) => {
                turns += 1;
                items.push({
                    id: 'durable-turn',
                    kind: 'turn',
                    turnId: 'durable-turn',
                    taskIds: wake.taskIds,
                    createdAt: 1,
                    endedAt: null,
                    state: 'running',
                    costUsd: 0
                });
                return true;
            },
            persist: async () => {
                await saved.promise;
                if (fail) {
                    throw new Error('disk full');
                }
            }
        })
    });
    const first = handler(entry);
    await Promise.resolve();
    expect(candidate.wake).toBe('pending');
    saved.resolve();
    await expect(first).rejects.toThrow('disk full');
    expect(candidate.wake).toBe('pending');
    fail = false;
    await handler(entry);
    expect(candidate.wake).toBe('sent');
    expect(turns).toBe(1);
});
