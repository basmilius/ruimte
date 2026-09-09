import { describe, expect, test } from 'bun:test';
import type { ChatItem, ChatToolItem } from '@ruimte/contracts';
import { deriveTimelineRows, summarizeGroup, turnLabel } from './timeline';

const tool = (id: string, name: string, input: unknown, state: ChatToolItem['state'] = 'done', turnId = 't1'): ChatToolItem => ({
    id,
    kind: 'tool',
    createdAt: 1,
    turnId,
    toolUseId: id,
    name,
    input,
    output: '',
    state,
    parentToolUseId: null
});

const thread: ChatItem[] = [
    { id: 't1', kind: 'turn', createdAt: 1000, turnId: 't1', state: 'done', endedAt: 13_000, costUsd: 0 },
    { id: 'u1', kind: 'user', createdAt: 1000, turnId: 't1', text: 'fix it' },
    tool('r1', 'Read', { file_path: 'a.ts' }),
    tool('r2', 'Read', { file_path: 'b.ts' }),
    tool('e1', 'Edit', { file_path: 'a.ts', old_string: 'x', new_string: 'y' }),
    { id: 'a1', kind: 'assistant', createdAt: 5000, turnId: 't1', text: 'Done.', streaming: false }
];

const options = { expandedGroups: new Set<string>(), expandedTurns: new Set<string>(), activeTurnId: null };

describe('deriveTimelineRows', () => {
    test('a settled turn folds its work behind a label and keeps the final answer and changed files', () => {
        const rows = deriveTimelineRows(thread, options);
        expect(rows.map((row) => row.kind)).toEqual(['user', 'turn-fold', 'changed-files', 'assistant']);
        expect(rows[1]).toMatchObject({ label: 'Worked for 12s', hiddenCount: 1, expanded: false });
        expect(rows[2]).toMatchObject({ tools: [{ id: 'e1' }] });
    });

    test('expanding the turn shows the grouped tool run, expanding the group shows every call', () => {
        const unfolded = deriveTimelineRows(thread, { ...options, expandedTurns: new Set(['t1']) });
        expect(unfolded.map((row) => row.kind)).toEqual(['user', 'turn-fold', 'work-group', 'changed-files', 'assistant']);
        expect(unfolded[2]).toMatchObject({ summary: '3 tool calls', expanded: false });

        const group = (unfolded[2] as { id: string }).id;
        const everything = deriveTimelineRows(thread, { ...options, expandedTurns: new Set(['t1']), expandedGroups: new Set([group]) });
        expect(everything.map((row) => row.kind)).toEqual(['user', 'turn-fold', 'work-group', 'work', 'work', 'work', 'changed-files', 'assistant']);
    });

    test('the active turn is never folded and ends with a working row; a running tool is live', () => {
        const active: ChatItem[] = [
            { id: 't2', kind: 'turn', createdAt: 1, turnId: 't2', state: 'running', endedAt: null, costUsd: 0 },
            { id: 'u2', kind: 'user', createdAt: 1, turnId: 't2', text: 'go' },
            tool('b1', 'Bash', { command: 'ls' }, 'done', 't2'),
            tool('b2', 'Bash', { command: 'bun test' }, 'running', 't2'),
            { id: 'a2', kind: 'assistant', createdAt: 2, turnId: 't2', text: '', streaming: true }
        ];
        const rows = deriveTimelineRows(active, { ...options, activeTurnId: 't2' });
        expect(rows.map((row) => row.kind)).toEqual(['user', 'work', 'work-live', 'assistant', 'working']);
    });

    test('pending approvals and questions stay off the transcript, answered ones are history', () => {
        const items: ChatItem[] = [
            { id: 't3', kind: 'turn', createdAt: 1, turnId: 't3', state: 'running', endedAt: null, costUsd: 0 },
            {
                id: 'q',
                kind: 'question',
                createdAt: 1,
                turnId: 't3',
                requestId: 'r',
                questions: [{ id: '0', header: 'H', question: 'Q?', choices: [], multiSelect: false }],
                answers: null,
                state: 'pending'
            },
            {
                id: 'p',
                kind: 'approval',
                createdAt: 1,
                turnId: 't3',
                requestId: 'r2',
                toolUseId: null,
                toolName: 'Bash',
                input: {},
                description: null,
                canAllowAlways: false,
                decision: 'deny'
            }
        ];
        const rows = deriveTimelineRows(items, { ...options, activeTurnId: 't3' });
        expect(rows.map((row) => row.kind)).toEqual(['approval', 'working']);
    });

    test('subagent tool calls stay hidden and items without a turn render as they are', () => {
        const items: ChatItem[] = [
            { id: 'u', kind: 'user', createdAt: 1, turnId: null, text: 'old' },
            { ...tool('inner', 'Read', {}), turnId: null, parentToolUseId: 'task-1' },
            { id: 'a', kind: 'assistant', createdAt: 2, turnId: null, text: 'old answer', streaming: false }
        ];
        expect(deriveTimelineRows(items, options).map((row) => row.kind)).toEqual(['user', 'assistant']);
    });
});

describe('labels', () => {
    test('summarizeGroup', () => {
        expect(summarizeGroup([tool('1', 'Read', {}), tool('2', 'Read', {})])).toBe('Read 2 files');
        expect(summarizeGroup([tool('1', 'Bash', {})])).toBe('Ran 1 command');
        expect(summarizeGroup([tool('1', 'Edit', { file_path: 'a' }), tool('2', 'Write', { file_path: 'a' })])).toBe('Edited 1 file');
        expect(summarizeGroup([tool('1', 'Read', {}), tool('2', 'Bash', {})])).toBe('2 tool calls');
    });

    test('turnLabel', () => {
        expect(turnLabel({ id: 't', kind: 'turn', createdAt: 0, turnId: 't', state: 'aborted', endedAt: 8000, costUsd: 0 })).toBe('You stopped after 8s');
        expect(turnLabel({ id: 't', kind: 'turn', createdAt: 0, turnId: 't', state: 'done', endedAt: 72_000, costUsd: 0 })).toBe('Worked for 1m 12s');
        expect(turnLabel({ id: 't', kind: 'turn', createdAt: 0, turnId: 't', state: 'error', endedAt: 500, costUsd: 0 })).toBe('Failed after 1s');
    });
});
