import { describe, expect, test } from 'bun:test';
import { moveRefusal, type MoveRefusalDeps } from './move-refusal.ts';

type Task = ReturnType<MoveRefusalDeps['tasks']['involving']>[number];
type Entry = ReturnType<MoveRefusalDeps['outbox']['list']>[number];

function deps(overrides: Partial<MoveRefusalDeps> = {}): MoveRefusalDeps {
    return {
        inChats: () => true,
        working: () => false,
        lineage: { openedCount: () => 0, startedBy: () => null },
        tasks: { involving: () => [] },
        outbox: { list: () => [] },
        notices: { waiting: () => [] },
        prWatches: { watchOf: () => null },
        ...overrides
    };
}

function tasks(...rows: Task[]): MoveRefusalDeps['tasks'] {
    return { involving: () => rows };
}

function outbox(...rows: Entry[]): MoveRefusalDeps['outbox'] {
    return { list: () => rows };
}

describe('moveRefusal', () => {
    test('lets a quiet chat in Chats go', () => {
        expect(moveRefusal('chat-1', deps())).toBeNull();
    });

    test('refuses a chat that is not a chat view of Chats', () => {
        expect(moveRefusal('chat-1', deps({ inChats: () => false }))).toEqual({ reason: 'not-in-chats' });
    });

    test('refuses a chat that works or waits on a person', () => {
        expect(moveRefusal('chat-1', deps({ working: () => true }))).toEqual({ reason: 'working' });
    });

    test('refuses a chat that opened agents, even ended ones, and one an agent opened', () => {
        expect(moveRefusal('chat-1', deps({ lineage: { openedCount: () => 1, startedBy: () => null } }))).toEqual({ reason: 'agents' });
        expect(moveRefusal('chat-1', deps({ lineage: { openedCount: () => 0, startedBy: () => 'chat-0' } }))).toEqual({ reason: 'agents' });
    });

    test('refuses a task the chat gave in any state and one it still works on', () => {
        expect(moveRefusal('chat-1', deps({ tasks: tasks({ parentId: 'chat-1', childId: 'chat-2', status: 'done' }) }))).toEqual({ reason: 'tasks' });
        expect(moveRefusal('chat-1', deps({ tasks: tasks({ parentId: 'chat-0', childId: 'chat-1', status: 'open' }) }))).toEqual({ reason: 'tasks' });
    });

    test('lets a chat go whose task as a child settled', () => {
        expect(moveRefusal('chat-1', deps({ tasks: tasks({ parentId: 'chat-0', childId: 'chat-1', status: 'done' }) }))).toBeNull();
    });

    test('refuses a chat the outbox owes work, with the moment of a resume after a limit', () => {
        const wake = { target: 'chat-1', kind: 'resume-run', notBefore: 5 };
        expect(moveRefusal('chat-1', deps({ outbox: outbox(wake) }))).toEqual({ reason: 'owed' });
        const limit = { target: 'chat-1', kind: 'resume-limit', notBefore: 1_700_000_000_000 };
        expect(moveRefusal('chat-1', deps({ outbox: outbox(wake, limit) }))).toEqual({ reason: 'owed', at: 1_700_000_000_000 });
        expect(moveRefusal('chat-1', deps({ outbox: outbox({ ...wake, target: 'chat-2' }) }))).toBeNull();
    });

    test('refuses a chat with messages waiting', () => {
        expect(moveRefusal('chat-1', deps({ notices: { waiting: () => [{}] } }))).toEqual({ reason: 'messages' });
    });

    test('refuses a chat that watches a pull request', () => {
        expect(moveRefusal('chat-1', deps({ prWatches: { watchOf: () => ({ id: 'w' }) } }))).toEqual({ reason: 'pr-watch' });
    });

    test('names the first reason in the order of the plan', () => {
        const busy = deps({ working: () => true, lineage: { openedCount: () => 2, startedBy: () => null } });
        expect(moveRefusal('chat-1', busy)).toEqual({ reason: 'working' });
        expect(moveRefusal('chat-1', { ...busy, inChats: () => false })).toEqual({ reason: 'not-in-chats' });
    });
});
