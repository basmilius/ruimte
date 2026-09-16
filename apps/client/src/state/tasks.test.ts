import { beforeEach, describe, expect, test } from 'bun:test';
import type { Task } from '@ruimte/contracts';
import { childTask, edgeTask, useTasks } from './tasks';

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
    id,
    projectId: 'project',
    parentId: 'chat-lead',
    childId: 'chat-child',
    title: id,
    prompt: 'go',
    status: 'open',
    result: null,
    createdAt: 1,
    settledAt: null,
    wake: 'pending',
    ...overrides
});

beforeEach(() => {
    useTasks.setState({ byEndpoint: {} });
});

describe('tasks', () => {
    test('a project answer replaces that project only, and an event lands on top of it', () => {
        const store = useTasks.getState();
        store.setProjectTasks('local', 'project', [task('a'), task('b', { projectId: 'other' })]);
        store.setProjectTasks('local', 'project', [task('c')]);
        expect(Object.keys(useTasks.getState().byEndpoint.local ?? {}).sort()).toEqual(['b', 'c']);
        store.putTask('local', task('c', { status: 'done' }));
        expect(useTasks.getState().byEndpoint.local?.c?.status).toBe('done');
        store.forget('local');
        expect(useTasks.getState().byEndpoint).toEqual({});
    });

    test('a node and a line show the newest task that is theirs', () => {
        const tasks = {
            old: task('old', { createdAt: 1, status: 'done' }),
            fresh: task('fresh', { createdAt: 5 }),
            elsewhere: task('elsewhere', { createdAt: 9, parentId: 'chat-other', childId: 'chat-third' })
        };
        expect(childTask(tasks, 'chat-child')?.id).toBe('fresh');
        expect(edgeTask(tasks, 'chat-lead', 'chat-child')?.id).toBe('fresh');
        expect(edgeTask(tasks, 'chat-child', 'chat-lead')).toBeNull();
        expect(childTask(undefined, 'chat-child')).toBeNull();
    });
});
