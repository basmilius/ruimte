import { describe, expect, test } from 'bun:test';
import type { ChatItem, Task } from '@ruimte/contracts';
import type { WakeParentEntry } from '../outbox/outbox.ts';
import { RESULT_PREVIEW_BYTES, parkedNote, wakeParentHandler, wakePrompt, type WakeChat } from './wake-parent.ts';

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
    const handler = wakeParentHandler({
        tasks: {
            pendingWake: () => tasks.filter((candidate) => candidate.status !== 'open' && candidate.wake === 'pending'),
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
        const prompt = wakePrompt([task('a', { result: { text, source: 'done', at: 1 } })]);
        expect(prompt).toStartWith('A task you gave has settled. Its result:\n\n## Title a (node chat-a, task a): done');
        expect(prompt).toContain('é'.repeat(RESULT_PREVIEW_BYTES / 2));
        expect(prompt).not.toContain('�');
        expect(prompt).toContain('ruimte-context read chat-a shows the rest');
    });

    test('a wake given up on leaves a note in that chat and raises attention; a start given up on tells the chat that opened the node', () => {
        const notes: string[] = [];
        const alerts: string[] = [];
        const park = parkedNote({
            madeBy: (nodeId) => (nodeId === 'terminal-1' ? 'chat-lead' : null),
            titleFor: () => 'Lexer',
            note: async (chatId, text) => {
                notes.push(`${chatId}: ${text}`);
            },
            alert: (chatId) => alerts.push(chatId)
        });
        park(entry, new Error('disk full'));
        park({ ...entry, kind: 'start-agent', target: 'terminal-1', payload: { node: 'terminal', provider: 'claude', cwd: null } }, new Error('no shell'));
        park({ ...entry, kind: 'start-agent', target: 'terminal-2', payload: { node: 'terminal', provider: 'claude', cwd: null } }, new Error('no shell'));
        expect(notes).toEqual([
            'chat-lead: The machine could not wake this chat with the results of its tasks: disk full',
            'chat-lead: The machine could not start the agent in Lexer (terminal-1): no shell'
        ]);
        expect(alerts).toEqual(['chat-lead']);
    });
});
