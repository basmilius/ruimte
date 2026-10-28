import { describe, expect, test } from 'bun:test';
import type { ChatItem } from '@ruimte/contracts';
import { shownWorkflow, workflowCandidates } from '@/chat/workflow/beside-workflows';

function call(id: string, state: 'running' | 'done', finishedAt?: number): ChatItem {
    return {
        id,
        kind: 'tool',
        createdAt: 0,
        turnId: null,
        toolUseId: id,
        name: 'Workflow',
        input: {},
        output: null,
        state,
        parentToolUseId: null,
        workflow: { name: id, taskId: `task-${id}`, phases: [], agents: [], ...(finishedAt === undefined ? {} : { finishedAt }) }
    };
}

function user(id: string, createdAt: number): ChatItem {
    return { id, kind: 'user', createdAt, turnId: null, text: 'Go on' };
}

function rowOf(items: ChatItem[], before: ChatItem[] = []) {
    const structure = Object.fromEntries([...before, ...items].map((item) => [item.id, item]));
    return { structure, order: items.map((item) => item.id), workflowsBefore: before.map((item) => item.id) };
}

describe('workflowCandidates', () => {
    test('the workflows from before the page come first, then those of the page, as the chat still speaks of them', () => {
        const row = rowOf([call('ended', 'done', 5), user('u', 10), call('new', 'running')], [call('older', 'running')]);
        expect(workflowCandidates(row).map((candidate) => [candidate.id, candidate.running])).toEqual([
            ['older', true],
            ['new', true]
        ]);
    });

    test('a finished one stays until the next message, and goes with it', () => {
        const before = rowOf([user('u1', 1), call('w', 'done', 5)]);
        expect(workflowCandidates(before).map((candidate) => candidate.id)).toEqual(['w']);
        expect(workflowCandidates(rowOf([user('u1', 1), call('w', 'done', 5), user('u2', 10)]))).toEqual([]);
    });

    test('answers the same array while the row is the same', () => {
        const row = rowOf([call('w', 'running')]);
        expect(workflowCandidates(row)).toBe(workflowCandidates({ ...row }));
    });
});

describe('shownWorkflow', () => {
    const candidates = workflowCandidates(rowOf([call('a', 'done', 5), call('b', 'running'), call('c', 'done', 7)]));

    test('shows the newest that runs, else the newest', () => {
        expect(shownWorkflow(candidates, undefined, [])).toMatchObject({ candidate: { id: 'b' }, index: 1, count: 3 });
        expect(shownWorkflow(candidates, undefined, ['b'])).toMatchObject({ candidate: { id: 'c' }, index: 1, count: 2 });
    });

    test('a pick stands while that workflow is there, also once a new one starts', () => {
        expect(shownWorkflow(candidates, 'a', [])?.candidate.id).toBe('a');
        expect(shownWorkflow(candidates, 'gone', [])?.candidate.id).toBe('b');
    });

    test('none once every one was dismissed', () => {
        expect(shownWorkflow(candidates, 'a', ['a', 'b', 'c'])).toBeNull();
        expect(shownWorkflow([], undefined, [])).toBeNull();
    });
});
