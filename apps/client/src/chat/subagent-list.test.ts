import { describe, expect, test } from 'bun:test';
import { CircleCheck, CircleSlash, CircleX, LoaderCircle } from 'lucide-react';
import type { ChatItem, ChatSubagentItem, ChatToolItem, Task } from '@ruimte/contracts';
import {
    latestPreview,
    needsTail,
    previewFor,
    previewOfItem,
    sectionSubagents,
    statusLookOf,
    statusWordOf,
    stopOf,
    subagentTitle,
    taskIdOf,
    threadWorkBy
} from './subagent-list';

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

const tool = (id: string, name: string, input: unknown, parentToolUseId: string | null = null): ChatToolItem => ({
    id,
    kind: 'tool',
    createdAt: 0,
    turnId: null,
    toolUseId: `use_${id}`,
    name,
    input,
    output: null,
    state: 'running',
    parentToolUseId
});

const reply = (id: string, text: string, parentToolUseId: string | null = null): ChatItem => ({
    id,
    kind: 'assistant',
    createdAt: 0,
    turnId: null,
    text,
    streaming: false,
    parentToolUseId
});

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
    test('running ones are active and everything that settled is done, each in thread order', () => {
        const a = subagent('a', { status: 'done' });
        const b = subagent('b');
        const c = subagent('c', { status: 'failed' });
        const d = subagent('d');
        expect(sectionSubagents([a, b, c, d])).toEqual({ active: [b, d], done: [a, c] });
        expect(sectionSubagents([b])).toEqual({ active: [b], done: [] });
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

    test('a tool call previews as its name and the summary the timeline gives it, a reply as its text on one line', () => {
        expect(previewOfItem(tool('1', 'Bash', { command: 'bun test', description: 'Run the tests' }))).toEqual({
            kind: 'tool',
            name: 'Bash',
            detail: 'Run the tests'
        });
        expect(previewOfItem(tool('2', 'Read', { file_path: '/src/a.ts' }))).toEqual({ kind: 'tool', name: 'Read', detail: '/src/a.ts' });
        expect(previewOfItem(reply('3', '## Found\n\nThree   places.'))).toEqual({ kind: 'text', text: 'Found Three places.' });
        expect(previewOfItem(reply('4', '   '))).toBeNull();
        expect(previewOfItem(note('5'))).toBeNull();
        expect(previewOfItem(subagent('g', { description: 'Deeper' }))).toEqual({ kind: 'tool', name: 'Agent', detail: 'Deeper' });
    });

    test('the latest preview skips what has nothing to say', () => {
        expect(latestPreview([tool('1', 'Grep', { pattern: 'foo' }), reply('2', 'Done looking'), note('3')])).toEqual({ kind: 'text', text: 'Done looking' });
        expect(latestPreview([note('1')])).toBeNull();
    });

    test('the work the thread kept is gathered per sub-agent in thread order', () => {
        const structure: Record<string, ChatItem> = {
            a: subagent('a'),
            t1: tool('t1', 'Read', {}, 'toolu_a'),
            main: reply('main', 'Main agent text'),
            t2: tool('t2', 'Grep', {}, 'toolu_b'),
            r1: reply('r1', 'Sub text', 'toolu_a')
        };
        const work = threadWorkBy(['a', 't1', 'main', 't2', 'r1'], structure);
        expect(work.get('toolu_a')?.map((item) => item.id)).toEqual(['t1', 'r1']);
        expect(work.get('toolu_b')?.map((item) => item.id)).toEqual(['t2']);
        expect(work.has('')).toBe(false);
    });

    test('only a running sub-agent whose latest step the thread lacks reads the tail', () => {
        const work = [tool('1', 'Read', {}, 'toolu_a')];
        expect(needsTail(subagent('a'), work, false)).toBe(false);
        expect(needsTail(subagent('a'), [], false)).toBe(true);
        expect(needsTail(subagent('a', { itemsTruncated: true }), work, false)).toBe(true);
        expect(needsTail(subagent('a', { status: 'done' }), [], false)).toBe(false);
        // A machine that refused reading has nothing to give a row without a pointer.
        expect(needsTail(subagent('a'), [], true)).toBe(false);
        expect(needsTail(subagent('a', { native: { agentId: 'x' } }), [], true)).toBe(true);
    });

    test('a running sub-agent previews the thread first, then the tail, then what the CLI last reported', () => {
        const work = [tool('1', 'Read', { file_path: '/a.ts' }, 'toolu_a')];
        const tail = [tool('9', 'Bash', { command: 'ls' })];
        expect(previewFor(subagent('a'), work, tail)).toEqual({ kind: 'tool', name: 'Read', detail: '/a.ts' });
        expect(previewFor(subagent('a', { itemsTruncated: true }), work, tail)).toEqual({ kind: 'tool', name: 'Bash', detail: 'ls' });
        expect(previewFor(subagent('a', { itemsTruncated: true, lastTool: 'Grep', summary: 'Searching' }), work, null)).toEqual({
            kind: 'tool',
            name: 'Grep',
            detail: 'Searching'
        });
        expect(previewFor(subagent('a', { summary: 'agent-1: running' }), [], null)).toEqual({ kind: 'text', text: 'agent-1: running' });
        expect(previewFor(subagent('a'), [], [])).toBeNull();
    });

    test('a settled sub-agent previews its report, then its last step, then its summary, and never a tail', () => {
        const work = [reply('1', 'Partial', 'toolu_a')];
        const tail = [tool('9', 'Bash', { command: 'ls' })];
        expect(previewFor(subagent('a', { status: 'done', result: 'The **report**\nin full' }), work, tail)).toEqual({
            kind: 'text',
            text: 'The report in full'
        });
        expect(previewFor(subagent('a', { status: 'failed' }), work, tail)).toEqual({ kind: 'text', text: 'Partial' });
        expect(previewFor(subagent('a', { status: 'failed', summary: 'Stopped' }), [], tail)).toEqual({ kind: 'text', text: 'Stopped' });
        expect(previewFor(subagent('a', { status: 'done' }), [], tail)).toBeNull();
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

test('each state has the icon and tone it has elsewhere, and only running spins', () => {
    expect(statusLookOf('running')).toEqual({ icon: LoaderCircle, tone: 'text-status-running', spins: true });
    expect(statusLookOf('done')).toEqual({ icon: CircleCheck, tone: 'text-status-idle', spins: false });
    expect(statusLookOf('failed')).toEqual({ icon: CircleX, tone: 'text-status-error', spins: false });
    expect(statusLookOf('cancelled')).toEqual({ icon: CircleSlash, tone: 'text-text-faint', spins: false });
});
