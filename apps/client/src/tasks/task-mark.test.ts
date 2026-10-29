import { describe, expect, test } from 'bun:test';
import type { Task } from '@ruimte/contracts';
import { showsTaskMark } from './task-mark';

function task(overrides: Partial<Task> = {}): Task {
    return {
        id: 'task',
        projectId: 'project',
        parentId: 'chat-lead',
        childId: 'chat-child',
        title: 'Merge test',
        prompt: 'go',
        status: 'open',
        result: null,
        createdAt: 1,
        settledAt: null,
        wake: 'pending',
        ...overrides
    };
}

describe('showsTaskMark', () => {
    test('a working agent hides the mark of its task, whatever state the task is in', () => {
        expect(showsTaskMark(task(), 'turn', false)).toBe(false);
        expect(showsTaskMark(task({ status: 'done' }), 'turn', false)).toBe(false);
        expect(showsTaskMark(task({ status: 'failed' }), 'delegating', false)).toBe(false);
    });

    test('a done task beside the unseen check leaves the check to say it once', () => {
        expect(showsTaskMark(task({ status: 'done' }), null, true)).toBe(false);
        expect(showsTaskMark(task({ status: 'done' }), null, false)).toBe(true);
    });

    test('a failed task still shows beside the unseen check, since it says more', () => {
        expect(showsTaskMark(task({ status: 'failed' }), null, true)).toBe(true);
    });

    test('a row that cannot tell whether its agent works keeps the mark', () => {
        expect(showsTaskMark(task(), undefined, false)).toBe(true);
    });
});
