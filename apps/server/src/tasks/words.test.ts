import { expect, test } from 'bun:test';
import type { Task } from '@ruimte/contracts';
import { RESULT_PREVIEW_BYTES, wakePrompt } from '@ruimte/agents/tasks/wake-parent';
import { TASK_WORDS } from './words.ts';

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

test('a cut result tells the parent in the verbs of ruimte-context where the rest is read', () => {
    const text = 'x'.repeat(RESULT_PREVIEW_BYTES + 1);
    const prompt = wakePrompt([task('a', { result: { text, source: 'done', at: 1 } })], 0, TASK_WORDS.restOf);
    expect(prompt).toEndWith(
        '\n\n[The result was cut at 8 KiB. ruimte-context read chat-a shows the rest once a line runs from that node into you; ruimte-context link new --to chat-a draws it.]'
    );
});
