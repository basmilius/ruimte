import { describe, expect, test } from 'bun:test';
import type { ChatItem, ChatToolItem, ChatTurnItem } from '@ruimte/contracts';
import { notResumedNote } from '@ruimte/contracts';
import { agentTurnLabel, deriveTimelineRows, isBlock, summarizeGroup, turnLabel } from './timeline';

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

const options = { expandedGroups: new Set<string>(), expandedTurns: new Set<string>(), expandedSubagents: new Set<string>(), activeTurnId: null };

describe('isBlock', () => {
    test('a changed files card is a block, so both threads set it apart from the tool lines above it', () => {
        const rows = deriveTimelineRows(thread, { ...options, expandedTurns: new Set(['t1']) });
        const kinds = rows.filter(isBlock).map((row) => row.kind);
        expect(kinds).toEqual(['changed-files', 'assistant']);
    });
});

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

    test('a turn the agent started itself opens with a header line instead of a user bubble', () => {
        const turn: ChatTurnItem = {
            id: 'ta',
            kind: 'turn',
            createdAt: 1000,
            turnId: 'ta',
            state: 'done',
            origin: 'agent',
            label: 'Report written',
            endedAt: 4000,
            costUsd: 0
        };
        const work = tool('r9', 'Read', { file_path: 'a.ts' }, 'done', 'ta');
        const items: ChatItem[] = [turn, work, { id: 'a9', kind: 'assistant', createdAt: 3000, turnId: 'ta', text: 'The report is ready.', streaming: false }];
        const rows = deriveTimelineRows(items, options);
        expect(rows.map((row) => row.kind)).toEqual(['turn-start', 'turn-fold', 'assistant']);
        expect(rows[0]).toMatchObject({ label: 'Sub-agent finished: Report written' });

        // While it runs it shows its work and the working row, like any other turn.
        const running: ChatItem[] = [{ ...turn, state: 'running', endedAt: null }, work];
        expect(deriveTimelineRows(running, { ...options, activeTurnId: 'ta' }).map((row) => row.kind)).toEqual(['turn-start', 'work', 'working']);
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

    test("a turn's checkpoint diff carries the card, also when no tool call reported an edit", () => {
        const checkpointDiff = { files: [{ path: 'src/a.ts', kind: 'update' as const, added: 2, deleted: 1, diff: '@@\n+a\n' }], truncated: false };
        const items: ChatItem[] = [
            { id: 't4', kind: 'turn', createdAt: 1, turnId: 't4', state: 'done', endedAt: 2, costUsd: 0, checkpoint: 'abc', checkpointDiff },
            { id: 'u4', kind: 'user', createdAt: 1, turnId: 't4', text: 'patch it' },
            tool('s1', 'Bash', { command: 'sed -i s/a/b/ src/a.ts' }, 'done', 't4')
        ];
        const rows = deriveTimelineRows(items, options);
        expect(rows.map((row) => row.kind)).toEqual(['user', 'turn-fold', 'changed-files']);
        expect(rows[2]).toMatchObject({ diff: checkpointDiff, checkpoint: true, tools: [] });
    });

    test('a checkpoint diff without files leaves the card out', () => {
        const items: ChatItem[] = [
            {
                id: 't5',
                kind: 'turn',
                createdAt: 1,
                turnId: 't5',
                state: 'done',
                endedAt: 2,
                costUsd: 0,
                checkpoint: 'abc',
                checkpointDiff: { files: [], truncated: false }
            },
            { id: 'u5', kind: 'user', createdAt: 1, turnId: 't5', text: 'look around' },
            { ...tool('e5', 'Edit', { file_path: 'a.ts', old_string: 'x', new_string: 'y' }), turnId: 't5' }
        ];
        expect(deriveTimelineRows(items, options).map((row) => row.kind)).toEqual(['user', 'turn-fold']);
    });

    test('a subagent is one row that carries its own work, and its text stays out of the thread', () => {
        const subagent: ChatItem = {
            id: 'sa1',
            kind: 'subagent',
            createdAt: 2,
            turnId: 't6',
            toolUseId: 'toolu_agent',
            description: 'Find the bug',
            subagentType: 'general-purpose',
            prompt: 'look around',
            background: true,
            status: 'running',
            startedAt: 2,
            finishedAt: null,
            summary: null,
            result: null,
            usage: null,
            lastTool: 'Grep',
            itemsTruncated: false
        };
        const items: ChatItem[] = [
            { id: 't6', kind: 'turn', createdAt: 1, turnId: 't6', state: 'running', endedAt: null, costUsd: 0 },
            { id: 'u6', kind: 'user', createdAt: 1, turnId: 't6', text: 'find it' },
            subagent,
            { ...tool('c1', 'Grep', { pattern: 'x' }, 'done', 't6'), parentToolUseId: 'toolu_agent' },
            { id: 'c2', kind: 'assistant', createdAt: 3, turnId: 't6', text: 'the bug is in a.ts', streaming: false, parentToolUseId: 'toolu_agent' }
        ];
        const rows = deriveTimelineRows(items, { ...options, activeTurnId: 't6' });
        expect(rows.map((row) => row.kind)).toEqual(['user', 'subagent', 'working']);
        expect(rows[1]).toMatchObject({ id: 'sa1', expanded: false, children: [{ id: 'c1' }, { id: 'c2' }] });
        expect(deriveTimelineRows(items, { ...options, activeTurnId: 't6', expandedSubagents: new Set(['sa1']) })[1]).toMatchObject({ expanded: true });
    });

    test('subagent tool calls of an older record stay hidden and items without a turn render as they are', () => {
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

    /* Edit, MultiEdit and ApplyPatch used to carry their own copy of this sentence, and counted the
       calls where the sentence says files. */
    test('a run that only edits counts the files it touched, whichever tool touched them', () => {
        expect(summarizeGroup([tool('1', 'Edit', { file_path: 'a' }), tool('2', 'Edit', { file_path: 'a' })])).toBe('Edited 1 file');
        expect(summarizeGroup([tool('1', 'MultiEdit', { file_path: 'a' }), tool('2', 'ApplyPatch', { file_path: 'b' })])).toBe('Edited 2 files');
        expect(summarizeGroup([tool('1', 'Write', { file_path: 'a' }), tool('2', 'Write', { file_path: 'b' })])).toBe('Wrote 2 files');
    });

    test('turnLabel', () => {
        expect(turnLabel({ id: 't', kind: 'turn', createdAt: 0, turnId: 't', state: 'aborted', endedAt: 8000, costUsd: 0 })).toBe('You stopped after 8s');
        expect(turnLabel({ id: 't', kind: 'turn', createdAt: 0, turnId: 't', state: 'done', endedAt: 72_000, costUsd: 0 })).toBe('Worked for 1m 12s');
        expect(turnLabel({ id: 't', kind: 'turn', createdAt: 0, turnId: 't', state: 'error', endedAt: 500, costUsd: 0 })).toBe('Failed after 1s');
    });

    test('an aborted turn the machine ended after a restart is not one the person stopped', () => {
        const turn = { id: 't', kind: 'turn' as const, createdAt: 0, turnId: 't', state: 'aborted' as const, endedAt: 8000, costUsd: 0 };
        const note = (text: string, level: 'info' | 'warning' = 'warning'): ChatItem => ({ id: 'n', kind: 'note', createdAt: 1, turnId: 't', level, text });
        expect(turnLabel(turn, [turn, note(notResumedNote('the agent had not started a session to resume yet'))])).toBe('Stopped after 8s');
        // Any other warning in a turn a person stopped (a CLI that retried, say) leaves it theirs.
        expect(turnLabel(turn, [turn, note('Codex could not resume its thread. Started a new one.')])).toBe('You stopped after 8s');
        expect(turnLabel(turn, [turn, { ...note(notResumedNote('x')), turnId: 'other' }])).toBe('You stopped after 8s');
    });

    test('agentTurnLabel', () => {
        const turn = { id: 't', kind: 'turn' as const, createdAt: 0, turnId: 't', state: 'done' as const, endedAt: 1, costUsd: 0 };
        expect(agentTurnLabel({ ...turn, origin: 'agent', label: 'slept' })).toBe('Sub-agent finished: slept');
        expect(agentTurnLabel({ ...turn, origin: 'agent' })).toBe('Continued on its own');
        expect(agentTurnLabel({ ...turn, origin: 'agent', label: 'Lexer', taskIds: ['task-1'] })).toBe('Woken by a task: Lexer');
        expect(agentTurnLabel({ ...turn, origin: 'agent', label: 'Lexer, Docs', taskIds: ['task-1', 'task-2'] })).toBe('Woken by 2 tasks: Lexer, Docs');
        expect(agentTurnLabel({ ...turn, origin: 'agent', label: 'Message from Lexer', messageFrom: ['chat-2'] })).toBe(
            'Woken by a message: Message from Lexer'
        );
        expect(agentTurnLabel({ ...turn, origin: 'agent', label: 'Messages from Lexer, Docs', messageFrom: ['chat-2', 'chat-3'] })).toBe(
            'Woken by 2 messages: Messages from Lexer, Docs'
        );
    });
});

describe('thinking rows', () => {
    const thinking = (streaming: boolean): ChatItem => ({
        id: 'k1',
        kind: 'thinking',
        createdAt: 1000,
        turnId: 't2',
        text: 'weighing it',
        streaming,
        endedAt: streaming ? null : 9000
    });

    test('a stretch that still runs sits in front of the answer, inside the open turn', () => {
        const rows = deriveTimelineRows(
            [
                { id: 't2', kind: 'turn', createdAt: 1000, turnId: 't2', state: 'running', endedAt: null, costUsd: 0 },
                { id: 'u2', kind: 'user', createdAt: 1000, turnId: 't2', text: 'think' },
                thinking(true)
            ],
            { ...options, activeTurnId: 't2' }
        );
        expect(rows.map((row) => row.kind)).toEqual(['user', 'thinking', 'working']);
    });

    test('a settled stretch folds behind the turn label, before the answer it led to', () => {
        const rows = deriveTimelineRows(
            [
                { id: 't2', kind: 'turn', createdAt: 1000, turnId: 't2', state: 'done', endedAt: 13_000, costUsd: 0 },
                { id: 'u2', kind: 'user', createdAt: 1000, turnId: 't2', text: 'think' },
                thinking(false),
                { id: 'a2', kind: 'assistant', createdAt: 9000, turnId: 't2', text: 'Done.', streaming: false }
            ],
            { ...options, expandedTurns: new Set(['t2']) }
        );
        expect(rows.map((row) => row.kind)).toEqual(['user', 'turn-fold', 'thinking', 'assistant']);
        expect(turnLabel({ id: 't2', kind: 'turn', createdAt: 1000, turnId: 't2', state: 'done', endedAt: 9000, costUsd: 0 })).toBe('Worked for 8s');
    });
});

test("a subagent's handback call reads as its report, and one without a message stays a tool call", () => {
    const items: ChatItem[] = [
        tool('b1', 'Bash', { command: 'git diff' }, 'done', 'x'),
        tool('h1', 'SubagentHandback', { message: '## Review\n\nAll good.' }, 'done', 'x'),
        tool('h2', 'SubagentHandback', {}, 'done', 'x')
    ].map((item) => ({ ...item, turnId: null }));
    const rows = deriveTimelineRows(items, options);
    expect(rows.map((row) => row.kind)).toEqual(['work', 'report', 'work']);
    expect(rows[1]).toEqual({ kind: 'report', id: 'h1', text: '## Review\n\nAll good.' });
});
