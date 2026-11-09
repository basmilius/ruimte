import { describe, expect, test } from 'bun:test';
import type { ChatState } from '@adecore/agents-react/state';
import type { AgentStatus, ChatInfo, Task } from '@ruimte/contracts';
import { childWaitOf, openChildTasks } from '@/state/delegation';
import type { SessionState } from '@/state/sessions';
import { chatInfoOf } from '../../testing/chat-info';

function task(id: string, childId: string, patch: Partial<Task> = {}): Task {
    return {
        id,
        projectId: 'p1',
        parentId: 'lead',
        childId,
        title: `Task ${id}`,
        prompt: '',
        status: 'open',
        result: null,
        createdAt: 1,
        settledAt: null,
        wake: 'pending',
        ...patch
    };
}

function chat(id: string, status: AgentStatus, patch: Partial<ChatInfo> = {}): Pick<ChatState, 'info'> {
    return { info: chatInfoOf(id, { status, ...patch }) };
}

function request(createdAt: number): NonNullable<ChatInfo['requests']>[number] {
    return { requestId: `r${createdAt}`, itemId: `i${createdAt}`, kind: 'approval', createdAt };
}

describe('the tasks a node still waits on', () => {
    test('are its own open ones, oldest first', () => {
        const tasks = {
            a: task('a', 'c1', { createdAt: 5 }),
            b: task('b', 'c2', { createdAt: 2 }),
            c: task('c', 'c3', { status: 'done' }),
            d: task('d', 'c4', { parentId: 'other' })
        };

        expect(openChildTasks(tasks, 'lead').map((open) => open.id)).toEqual(['b', 'a']);
        expect(openChildTasks(undefined, 'lead')).toEqual([]);
    });
});

describe('the child a person should look at', () => {
    test('is none while every child works on its own', () => {
        expect(childWaitOf('lead', { a: task('a', 'c1') }, {}, { 'local:c1': chat('c1', 'running') }, 'local')).toBeNull();
    });

    test('is a child chat that needs you, dated by its oldest request', () => {
        const chats = { 'local:c1': chat('c1', 'needs-you', { requests: [request(40), request(30)] }) };
        const wait = childWaitOf('lead', { a: task('a', 'c1') }, {}, chats, 'local');

        expect(wait).toMatchObject({ kind: 'needs-you', since: 30, task: { id: 'a' } });
    });

    test('is a running child chat that still holds an open request', () => {
        const chats = { 'local:c1': chat('c1', 'running', { requests: [request(10)] }) };

        expect(childWaitOf('lead', { a: task('a', 'c1') }, {}, chats, 'local')?.kind).toBe('needs-you');
    });

    test('is a child terminal whose live agent needs you', () => {
        const sessions: Record<string, SessionState> = {
            'local:t1': {
                attached: true,
                agent: { kind: 'claude', agentSessionId: 'a', transcriptPath: null, status: 'needs-you', live: true, updatedAt: 70 }
            }
        };

        expect(childWaitOf('lead', { a: task('a', 't1') }, sessions, {}, 'local')).toMatchObject({ kind: 'needs-you', since: 70 });
    });

    test('puts a child that needs you before one paused on a limit', () => {
        const tasks = { a: task('a', 'c1', { paused: { kind: 'usage', until: 900 } }), b: task('b', 'c2', { createdAt: 3 }) };
        const chats = { 'local:c1': chat('c1', 'idle'), 'local:c2': chat('c2', 'needs-you') };

        expect(childWaitOf('lead', tasks, {}, chats, 'local')).toMatchObject({ kind: 'needs-you', task: { id: 'b' } });
    });

    test('is a child paused on a limit, with when it lifts', () => {
        const tasks = { a: task('a', 'c1', { paused: { kind: 'overload' } }) };

        expect(childWaitOf('lead', tasks, {}, {}, 'local')).toMatchObject({ kind: 'paused', limit: 'overload', until: null });
    });

    test('leaves a settled task alone, whatever its child does now', () => {
        const chats = { 'local:c1': chat('c1', 'needs-you') };

        expect(childWaitOf('lead', { a: task('a', 'c1', { status: 'done' }) }, {}, chats, 'local')).toBeNull();
    });
});
