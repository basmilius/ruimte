import { describe, expect, test } from 'bun:test';
import type { ChatInfo } from '@ruimte/contracts';
import { ClaudeStreamReducer } from './claude-stream.ts';
import { ChatThread } from './thread.ts';

const info: ChatInfo = {
    chatId: 'c',
    cwd: '/',
    agentSessionId: null,
    model: null,
    status: 'running',
    running: true,
    usage: { contextTokens: 0, contextWindow: null, costUsd: 0, turns: 0 },
    createdAt: 0
};

const setup = () => {
    const thread = new ChatThread(info);
    let clock = 1;
    const reducer = new ClaudeStreamReducer(thread, () => clock++);
    return { thread, reducer };
};

const usage = { input_tokens: 8, cache_creation_input_tokens: 2671, cache_read_input_tokens: 24869, output_tokens: 1 };

describe('ClaudeStreamReducer', () => {
    test('streams text by message and text ordinal, then the final frames replace it in place', () => {
        const { thread, reducer } = setup();
        reducer.handle({ type: 'system', subtype: 'init', session_id: 'sid', model: 'm' });
        expect(thread.info).toMatchObject({ agentSessionId: 'sid', model: 'm' });

        reducer.handle({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1' } } });
        reducer.handle({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } } });
        reducer.handle({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } } });
        const delta = reducer.handle({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'po' } } });
        expect(delta.events).toEqual([{ type: 'delta', itemId: 'msg_1:t0', text: 'po' }]);
        reducer.handle({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'ng' } } });
        expect(thread.get('msg_1:t0')).toMatchObject({ kind: 'assistant', text: 'pong', streaming: true });

        reducer.handle({ type: 'assistant', message: { id: 'msg_1', content: [{ type: 'thinking', thinking: '' }], usage } });
        reducer.handle({ type: 'assistant', message: { id: 'msg_1', content: [{ type: 'text', text: 'pong' }], usage } });
        expect(thread.list().map((item) => item.id)).toEqual(['msg_1:t0']);
        expect(thread.get('msg_1:t0')).toMatchObject({ text: 'pong', streaming: false });
        expect(thread.info.usage.contextTokens).toBe(27548);
    });

    test('a tool call, its result and the turn end', () => {
        const { thread, reducer } = setup();
        reducer.handle({ type: 'system', subtype: 'init', session_id: 'sid', model: 'm' });
        reducer.handle({
            type: 'assistant',
            message: { id: 'msg_2', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'date' } }], usage }
        });
        expect(thread.get('toolu_1')).toMatchObject({ kind: 'tool', name: 'Bash', input: { command: 'date' }, state: 'running', output: null });

        reducer.handle({
            type: 'user',
            message: { role: 'user', content: [{ tool_use_id: 'toolu_1', type: 'tool_result', content: 'Wed Sep 9', is_error: false }] }
        });
        expect(thread.get('toolu_1')).toMatchObject({ state: 'done', output: 'Wed Sep 9' });

        const out = reducer.handle({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.02, modelUsage: { m: { contextWindow: 200000 } } });
        expect(out.events.at(-1)).toMatchObject({ type: 'info', info: { status: 'idle', usage: { costUsd: 0.02, turns: 1, contextWindow: 200000 } } });
    });

    test('a permission request becomes a pending approval and needs-you, and a cancel closes it', () => {
        const { thread, reducer } = setup();
        const out = reducer.handle({
            type: 'control_request',
            request_id: 'r1',
            request: { subtype: 'can_use_tool', tool_name: 'Edit', input: { file_path: 'a.ts' }, tool_use_id: 'toolu_9' }
        });
        expect(out.actions).toEqual([{ type: 'approval', requestId: 'r1', toolUseId: 'toolu_9' }]);
        expect(thread.get('approval-r1')).toMatchObject({ kind: 'approval', toolName: 'Edit', decision: 'pending' });
        expect(thread.info.status).toBe('needs-you');

        reducer.handle({ type: 'control_cancel_request', request_id: 'r1' });
        expect(thread.get('approval-r1')).toMatchObject({ decision: 'cancelled' });
        expect(thread.info.status).toBe('running');
    });

    test('finish closes what is open and reports a crash', () => {
        const { thread, reducer } = setup();
        reducer.handle({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_3' } } });
        reducer.handle({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
        reducer.finish(1);
        expect(thread.get('msg_3:t0')).toMatchObject({ streaming: false });
        expect(thread.list().at(-1)).toMatchObject({ kind: 'note', level: 'error', text: 'Claude Code exited with code 1' });
        expect(thread.info).toMatchObject({ running: false, status: 'error' });
    });

    test('ignores frames it does not know', () => {
        const { thread, reducer } = setup();
        expect(reducer.handle({ type: 'rate_limit_event' }).events).toEqual([]);
        expect(reducer.handle('junk').events).toEqual([]);
        expect(thread.list()).toEqual([]);
    });
});
