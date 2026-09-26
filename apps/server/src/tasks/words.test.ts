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

test('a long result is cut at a character boundary with the way to the rest', () => {
    const text = `${'é'.repeat(RESULT_PREVIEW_BYTES)}`;
    const prompt = wakePrompt([task('a', { result: { text, source: 'done', at: 1 } })], 0, TASK_WORDS.restOf);
    expect(prompt).toStartWith('A task you gave has settled. Its result:\n\n## Title a (node chat-a, task a): done');
    expect(prompt).toContain('é'.repeat(RESULT_PREVIEW_BYTES / 2));
    expect(prompt).not.toContain('�');
    expect(prompt).toContain('ruimte-context read chat-a shows the rest');
    expect(prompt).toEndWith(
        '\n\n[The result was cut at 8 KiB. ruimte-context read chat-a shows the rest once a line runs from that node into you; ruimte-context link new --to chat-a draws it.]'
    );
});
