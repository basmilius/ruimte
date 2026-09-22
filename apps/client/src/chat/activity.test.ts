import { describe, expect, test } from 'bun:test';
import type { ChatBackgroundTask, ChatItem, ChatSubagentItem } from '@ruimte/contracts';
import { backgroundCounts, runningOwnSubagents } from '@/chat/activity';

const subagent = (id: string, patch: Partial<ChatSubagentItem>): ChatSubagentItem => ({
    id,
    kind: 'subagent',
    createdAt: 0,
    turnId: null,
    toolUseId: id,
    description: '',
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

const task = (id: string, kind: ChatBackgroundTask['kind']): ChatBackgroundTask => ({ id, kind, description: '', command: null, startedAt: 0 });

describe('chat activity', () => {
    test('counts only the running sub-agents of the CLI itself', () => {
        const structure: Record<string, ChatItem> = {
            a: subagent('a', {}),
            b: subagent('b', { status: 'done' }),
            c: subagent('c', { origin: 'ruimte' }),
            d: subagent('d', { origin: 'native', background: true })
        };
        expect(runningOwnSubagents(structure)).toBe(2);
        expect(runningOwnSubagents(undefined)).toBe(0);
    });

    test('splits what runs in the background into shells and monitors', () => {
        expect(backgroundCounts([task('1', 'shell'), task('2', 'monitor'), task('3', 'shell')])).toEqual({ shells: 2, monitors: 1 });
    });
});
