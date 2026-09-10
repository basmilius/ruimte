import { describe, expect, test } from 'bun:test';
import type { ChatToolItem } from '@ruimte/contracts';
import { approvalChanges, formatElapsed, hasFileChanges, liveOutput, toolStartedAt, unifiedChanges } from './tools';

const running = (progress?: ChatToolItem['progress']): ChatToolItem => ({
    id: 'b1',
    kind: 'tool',
    createdAt: 5000,
    turnId: 't1',
    toolUseId: 'b1',
    name: 'Bash',
    input: { command: 'bun test' },
    output: null,
    state: 'running',
    parentToolUseId: null,
    progress
});

describe('live tool helpers', () => {
    test('the start is what the CLI reported, or when the call appeared', () => {
        expect(toolStartedAt(running())).toBe(5000);
        expect(toolStartedAt(running({ startedAt: null, description: 'x', output: null }))).toBe(5000);
        expect(toolStartedAt(running({ startedAt: 2000, description: null, output: null }))).toBe(2000);
    });

    test('partial output shows as its tail, and not at all when nothing streamed', () => {
        expect(liveOutput(running())).toBeNull();
        expect(liveOutput(running({ startedAt: null, description: null, output: '' }))).toBeNull();
        const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
        expect(liveOutput(running({ startedAt: null, description: null, output: `${lines}\n` }))).toBe(
            Array.from({ length: 12 }, (_, i) => `line ${i + 8}`).join('\n')
        );
    });

    test('elapsed time reads as seconds, then minutes', () => {
        expect(formatElapsed(-5)).toBe('0s');
        expect(formatElapsed(12_400)).toBe('12s');
        expect(formatElapsed(120_000)).toBe('2m');
        expect(formatElapsed(125_000)).toBe('2m 5s');
    });
});

const patched = (changes: ChatToolItem['changes']): ChatToolItem => ({
    ...running(),
    id: 'p1',
    toolUseId: 'p1',
    name: 'ApplyPatch',
    input: { summary: 'a.ts' },
    output: '-x\n+y\n',
    state: 'done',
    progress: undefined,
    changes
});

describe('file change helpers', () => {
    test('a call carries the unified diffs a provider reported, and an empty diff is nothing to show', () => {
        expect(unifiedChanges(patched([{ path: 'a.ts', kind: 'update', diff: '-x\n+y\n' }]))).toHaveLength(1);
        expect(unifiedChanges(patched([{ path: 'a.ts', kind: 'update', diff: '' }]))).toEqual([]);
        expect(unifiedChanges(running())).toEqual([]);
    });

    test('a turn shows a call in its changed files card when either kind of change is there', () => {
        expect(hasFileChanges(patched([{ path: 'a.ts', kind: 'update', diff: '-x\n+y\n' }]))).toBe(true);
        expect(hasFileChanges(patched([]))).toBe(false);
        expect(hasFileChanges({ ...running(), name: 'Write', input: { file_path: 'a.ts', content: 'hi' } })).toBe(true);
    });

    test('an approval repeats the diffs in its input, and anything else is no diff at all', () => {
        expect(approvalChanges({ summary: 'a.ts', changes: [{ path: 'a.ts', kind: 'update', diff: '-x\n' }] })).toHaveLength(1);
        expect(approvalChanges({ changes: [{ path: 'a.ts', diff: '' }] })).toEqual([]);
        expect(approvalChanges({ command: 'date' })).toEqual([]);
        expect(approvalChanges(null)).toEqual([]);
    });
});
