import { describe, expect, test } from 'bun:test';
import type { ChatItem, ChatToolItem } from '@ruimte/contracts';
import { agentActivity } from './agent-activity';

const tool = (id: string, changes: Partial<ChatToolItem> = {}): ChatToolItem => ({
    id,
    toolUseId: id,
    kind: 'tool',
    name: 'exec_command',
    createdAt: 1,
    turnId: 'turn',
    input: { command: 'bun test', secret: 'not for the summary' },
    output: '12 tests passed',
    state: 'done',
    parentToolUseId: null,
    ...changes
});

describe('agent activity for voice', () => {
    test('lists recent tools without reasoning, arbitrary arguments or output', () => {
        const items: ChatItem[] = [
            tool('old'),
            { id: 'thinking', kind: 'thinking', createdAt: 1, turnId: 'turn', text: 'private', streaming: false, endedAt: 2 },
            tool('new')
        ];
        const result = agentActivity(items, 1, null);
        expect(result.tools).toHaveLength(1);
        expect(result.tools[0]).toMatchObject({ id: 'new', input: 'command: bun test', output: null });
        expect(result.truncated).toBe(true);
        expect(JSON.stringify(result)).not.toContain('private');
        expect(JSON.stringify(result)).not.toContain('not for the summary');
    });

    test('a specific result is bounded and distinguishes failures and subagent calls', () => {
        const result = agentActivity([tool('call', { output: 'x'.repeat(7000), state: 'error', parentToolUseId: 'parent' })], 10, 'call');
        expect(result.tools[0]).toMatchObject({ state: 'error', parentToolUseId: 'parent', truncated: true });
        expect(result.tools[0]!.output).toHaveLength(6000);
    });

    test('a running tool exposes its progress only when its result is requested', () => {
        const items = [tool('call', { output: null, state: 'running', progress: { startedAt: 1, description: null, output: 'Working' } })];
        expect(agentActivity(items, 10, null).tools[0]!.output).toBeNull();
        expect(agentActivity(items, 10, 'call').tools[0]!.output).toBe('Working');
        expect(agentActivity(items, 10, 'missing').tools).toEqual([]);
    });
});
