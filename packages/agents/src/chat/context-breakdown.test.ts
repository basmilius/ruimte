import { describe, expect, test } from 'bun:test';
import type { ChatItem } from '@ruimte/agent-contracts';
import { estimateContextBreakdown } from './context-breakdown.ts';

const base = { createdAt: 0, turnId: 't' };

const user = (id: string, text: string, extra: Partial<Extract<ChatItem, { kind: 'user' }>> = {}): ChatItem => ({ ...base, id, kind: 'user', text, ...extra });

const assistant = (id: string, text: string, parentToolUseId: string | null = null): ChatItem => ({
    ...base,
    id,
    kind: 'assistant',
    text,
    streaming: false,
    parentToolUseId
});

const tool = (id: string, name: string, output: string, parentToolUseId: string | null = null): ChatItem => ({
    ...base,
    id,
    kind: 'tool',
    toolUseId: id,
    name,
    input: {},
    output,
    state: 'done',
    parentToolUseId
});

const compaction = (id: string): ChatItem => ({ ...base, id, kind: 'compaction', preTokens: null });

const text = (tokens: number): string => 'x'.repeat(tokens * 4);

describe('estimateContextBreakdown', () => {
    test('counts read tools as files read, other tools as tool output and messages as conversation', () => {
        const items = [
            user('u1', text(100)),
            tool('r1', 'Read', text(5000)),
            tool('r2', 'filesystem/read_file', text(2000)),
            tool('b1', 'Bash', text(1000)),
            assistant('a1', text(200))
        ];
        const breakdown = estimateContextBreakdown(items, 20_000);
        // `{}` as input is two characters, which rounds up to one token per call.
        expect(breakdown).toEqual({ filesRead: 7002, toolOutput: 1001, conversation: 300, system: 11_697 });
        expect(breakdown.filesRead).toBeGreaterThan(breakdown.toolOutput + breakdown.conversation);
    });

    test('scales the estimate down to the reported total, leaving system no more than the rounding', () => {
        const items = [tool('r1', 'Read', text(6000)), tool('b1', 'Bash', text(3000)), assistant('a1', text(999))];
        const breakdown = estimateContextBreakdown(items, 5000);
        expect(breakdown.system).toBeLessThanOrEqual(2);
        expect(breakdown.filesRead + breakdown.toolOutput + breakdown.conversation + breakdown.system).toBe(5000);
        expect(breakdown.filesRead).toBeGreaterThan(breakdown.toolOutput);
        expect(breakdown.toolOutput).toBeGreaterThan(breakdown.conversation);
    });

    test('only counts what comes after the last compaction', () => {
        const items = [tool('r1', 'Read', text(50_000)), compaction('c1'), user('u1', text(100)), tool('b1', 'Bash', text(400))];
        expect(estimateContextBreakdown(items, 10_000)).toEqual({ filesRead: 0, toolOutput: 401, conversation: 100, system: 9499 });
    });

    test('leaves out the work a subagent did inside its own context', () => {
        const items: ChatItem[] = [
            {
                ...base,
                id: 's1',
                kind: 'subagent',
                toolUseId: 's1',
                description: 'look around',
                subagentType: null,
                prompt: text(50),
                background: false,
                status: 'done',
                startedAt: 0,
                finishedAt: 1,
                summary: null,
                result: text(150),
                usage: null,
                lastTool: null,
                itemsTruncated: false
            },
            tool('r1', 'Read', text(9000), 's1'),
            assistant('a1', text(900), 's1')
        ];
        expect(estimateContextBreakdown(items, 1000)).toEqual({ filesRead: 0, toolOutput: 200, conversation: 0, system: 800 });
    });

    test('counts an attached picture as a file read, whatever its size', () => {
        const attachments = [
            { id: 'p', name: 'shot.png', mime: 'image/png', size: 4_000_000, path: '/tmp/shot.png' },
            { id: 'd', name: 'notes.txt', mime: 'text/plain', size: 4_000_000, path: '/tmp/notes.txt' }
        ];
        expect(estimateContextBreakdown([user('u1', '', { attachments })], 10_000)).toEqual({ filesRead: 1600, toolOutput: 0, conversation: 0, system: 8400 });
    });

    test('never answers a negative part', () => {
        expect(estimateContextBreakdown([], 0)).toEqual({ filesRead: 0, toolOutput: 0, conversation: 0, system: 0 });
        expect(estimateContextBreakdown([user('u1', text(10))], 0)).toEqual({ filesRead: 0, toolOutput: 0, conversation: 0, system: 0 });
    });
});
