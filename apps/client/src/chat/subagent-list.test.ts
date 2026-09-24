import { describe, expect, test } from 'bun:test';
import type { ChatItem, ChatSubagentItem, Task } from '@ruimte/contracts';
import { composerStopLabel, composerStopOf, entryTimeOf, flyoutSubagents, statusWordOf, stopOf, subagentTitle, summaryWordOf, taskIdOf } from './subagent-list';

const subagent = (id: string, patch: Partial<ChatSubagentItem> = {}): ChatSubagentItem => ({
    id,
    kind: 'subagent',
    createdAt: 0,
    turnId: null,
    toolUseId: `toolu_${id}`,
    description: `Agent ${id}`,
    subagentType: null,
    prompt: null,
    background: false,
    status: 'running',
    startedAt: 0,
    finishedAt: null,
    summary: null,
    result: null,
    usage: null,
    lastTool: null,
    itemsTruncated: false,
    ...patch
});

const message = (id: string): ChatItem => ({ id, kind: 'user', createdAt: 0, turnId: null, text: id });

const note = (id: string): ChatItem => ({ id, kind: 'note', createdAt: 0, turnId: null, level: 'info', text: id });

const task = (status: Task['status']): Task => ({
    id: 't1',
    projectId: 'p',
    parentId: 'parent',
    childId: 'child',
    title: 'Survey',
    prompt: 'Survey the code',
    status,
    result: null,
    createdAt: 0,
    settledAt: null,
    wake: 'none'
});

describe('subagent list', () => {
    test('the flyout lists what runs and what settled since the last message, in thread order', () => {
        const early = subagent('early', { status: 'done', turnId: 'turn-1' });
        const background = subagent('background', { turnId: 'turn-1', background: true });
        const sibling = subagent('sibling', { status: 'done', turnId: 'turn-1' });
        const older = subagent('older', { status: 'done', turnId: 'turn-2' });
        const survey = subagent('survey', { status: 'done', turnId: 'turn-3' });
        const task = subagent('task', { origin: 'ruimte', childId: 'node-1', turnId: 'turn-3', status: 'failed' });
        const structure: Record<string, ChatItem> = { early, background, sibling, older, survey, task, u1: message('u1'), u2: message('u2'), n: note('n') };
        const order = ['u1', 'early', 'background', 'sibling', 'older', 'u2', 'survey', 'n', 'task'];
        expect(flyoutSubagents(order, structure)).toEqual([early, background, sibling, survey, task]);
        expect(flyoutSubagents([...order, 'u3'], { ...structure, u3: message('u3') })).toEqual([early, background, sibling]);
        expect(flyoutSubagents(['survey', 'task'], structure)).toEqual([survey, task]);
    });

    test('a row from before the last message that a message woke again stays once it settles', () => {
        const woken = subagent('woken', { status: 'done', turnId: 'turn-1', startedAt: 20, finishedAt: 30 });
        const settled = subagent('settled', { status: 'done', turnId: 'turn-1', startedAt: 1, finishedAt: 5 });
        const structure: Record<string, ChatItem> = { woken, settled, u1: { ...message('u1'), createdAt: 10 } };
        expect(flyoutSubagents(['settled', 'woken', 'u1'], structure)).toEqual([woken]);
    });

    test('the badge shows work in progress first, then a failure, then a cancel, and done only when all are', () => {
        expect(summaryWordOf(['done', 'failed', 'running'])).toBe('running');
        expect(summaryWordOf(['done', 'cancelled', 'failed'])).toBe('failed');
        expect(summaryWordOf(['done', 'cancelled'])).toBe('cancelled');
        expect(summaryWordOf(['done', 'done'])).toBe('done');
    });

    test('a cancelled task says so, where the row itself only knows it failed', () => {
        const row = subagent('task-t1', { origin: 'ruimte', childId: 'child', status: 'failed' });
        expect(taskIdOf(row)).toBe('t1');
        expect(taskIdOf(subagent('a'))).toBeNull();
        expect(statusWordOf(row, task('cancelled'))).toBe('cancelled');
        expect(statusWordOf(row, task('failed'))).toBe('failed');
        expect(statusWordOf(row, null)).toBe('failed');
        expect(statusWordOf(subagent('a', { status: 'done' }), null)).toBe('done');
    });

    test('the title falls back from the description to what the CLI said and then to the kind', () => {
        expect(subagentTitle(subagent('a'))).toBe('Agent a');
        expect(subagentTitle(subagent('a', { description: '', summary: 'Looking around' }))).toBe('Looking around');
        expect(subagentTitle(subagent('a', { description: '', subagentType: 'Explore' }))).toBe('Explore');
        expect(subagentTitle(subagent('a', { description: '' }))).toBe('Sub-agent');
    });
});

describe('stopping an active entry', () => {
    test('a task stops its node, turn or not, and a subagent of the CLI is only marked once no turn runs', () => {
        const task = subagent('t', { origin: 'ruimte', childId: 'node-1', background: true });
        expect(stopOf(task, true)).toBe('task');
        expect(stopOf(task, false)).toBe('task');
        const native = subagent('n', { background: true });
        expect(stopOf(native, false)).toBe('mark');
        // The turn may still be waiting on it; the composer's Stop is the way then.
        expect(stopOf(native, true)).toBeNull();
    });

    test('nothing is offered for a row that settled, or a task that names no node', () => {
        expect(stopOf(subagent('d', { status: 'done' }), false)).toBeNull();
        expect(stopOf(subagent('f', { status: 'failed', origin: 'ruimte', childId: 'node-1' }), false)).toBeNull();
        expect(stopOf(subagent('o', { origin: 'ruimte' }), false)).toBeNull();
    });
});

describe('the time on the right of an entry', () => {
    const noon = new Date(2026, 8, 16, 12, 0, 0).getTime();

    test('a running entry counts from its start, in seconds, minutes and hours', () => {
        expect(entryTimeOf(subagent('a', { startedAt: noon - 12_000 }), null, noon)).toBe('12s');
        expect(entryTimeOf(subagent('a', { startedAt: noon - 134_000 }), null, noon)).toBe('2m 14s');
        expect(entryTimeOf(subagent('a', { startedAt: noon - 3_780_000 }), null, noon)).toBe('1h 3m');
        expect(entryTimeOf(subagent('a', { startedAt: noon - 7_200_000 }), null, noon)).toBe('2h');
        expect(entryTimeOf(subagent('a', { startedAt: 0 }), null, noon)).toBe('');
    });

    test('a settled entry says how long it took, and only its state without both ends', () => {
        expect(entryTimeOf(subagent('a', { status: 'done', startedAt: noon - 42_000, finishedAt: noon }), null, noon)).toBe('done in 42s');
        expect(entryTimeOf(subagent('a', { status: 'failed', startedAt: noon - 72_000, finishedAt: noon }), null, noon)).toBe('failed after 1m 12s');
        expect(entryTimeOf(subagent('a', { status: 'done', startedAt: noon, finishedAt: null }), null, noon)).toBe('done');
        expect(entryTimeOf(subagent('a', { status: 'done', startedAt: 0, finishedAt: noon }), null, noon)).toBe('done');
    });

    test("a task's own record gives its times and says it was cancelled", () => {
        const given = noon - 65_000;
        const task = { createdAt: given, settledAt: null, status: 'open' } as unknown as Task;
        const row = subagent('t', { origin: 'ruimte', childId: 'node-1', startedAt: noon - 1_000 });
        expect(entryTimeOf(row, task, noon)).toBe('1m 5s');
        const settled = { ...task, settledAt: noon - 30_000, status: 'cancelled' } as Task;
        expect(entryTimeOf({ ...row, status: 'failed', finishedAt: null }, settled, noon)).toBe('cancelled after 35s');
    });
});

describe("the composer's Stop", () => {
    test('stops the turn alone on a plain click and its sub-agents too with Shift, and says so', () => {
        expect(composerStopOf(false)).toBe('turn');
        expect(composerStopOf(true)).toBe('turn-and-subagents');
        expect(composerStopLabel()).toBe('Stop, Shift-click to also stop its sub-agents');
    });
});
