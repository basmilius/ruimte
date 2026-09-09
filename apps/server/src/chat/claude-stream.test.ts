import { describe, expect, test } from 'bun:test';
import type { ChatInfo } from '@ruimte/contracts';
import { ClaudeStreamReducer } from './claude-stream.ts';
import { ChatThread } from './thread.ts';

const info: ChatInfo = {
    chatId: 'c',
    provider: 'claude',
    cwd: '/',
    agentSessionId: null,
    model: null,
    selection: { model: 'claude-sonnet-5', options: {} },
    runtimeMode: 'full-access',
    interactionMode: 'default',
    status: 'running',
    running: true,
    activeTurnId: 'turn-1',
    slashCommands: [],
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
        expect(delta.events).toEqual([{ type: 'delta', itemId: '0:msg_1:t0', text: 'po' }]);
        reducer.handle({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'ng' } } });
        expect(thread.get('0:msg_1:t0')).toMatchObject({ kind: 'assistant', text: 'pong', streaming: true });

        reducer.handle({ type: 'assistant', message: { id: 'msg_1', content: [{ type: 'thinking', thinking: '' }], usage } });
        reducer.handle({ type: 'assistant', message: { id: 'msg_1', content: [{ type: 'text', text: 'pong' }], usage } });
        expect(thread.list().map((item) => item.id)).toEqual(['0:msg_1:t0']);
        expect(thread.get('0:msg_1:t0')).toMatchObject({ text: 'pong', streaming: false });
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
        expect(out.events.at(-1)).toMatchObject({
            type: 'info',
            info: { status: 'idle', activeTurnId: null, usage: { costUsd: 0.02, turns: 1, contextWindow: 200000 } }
        });
        expect(thread.get('toolu_1')?.turnId).toBe('turn-1');
    });

    test('progress frames give a running tool its start and description, and the result drops them', () => {
        const { thread, reducer } = setup();
        reducer.handle({
            type: 'assistant',
            message: { id: 'msg_4', content: [{ type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { command: 'sleep 40' } }], usage }
        });
        expect(
            reducer.handle({ type: 'system', subtype: 'task_started', tool_use_id: 'toolu_2', description: 'Wait a while', task_type: 'local_bash' }).events
        ).toHaveLength(1);
        expect(thread.get('toolu_2')).toMatchObject({ progress: { startedAt: null, description: 'Wait a while', output: null } });

        // The reducer's clock reads 2 on this frame; 30 s of elapsed time puts the start before the thread began.
        reducer.handle({ type: 'tool_progress', tool_use_id: 'toolu_2', tool_name: 'Bash', parent_tool_use_id: null, elapsed_time_seconds: 30, task_id: 't' });
        expect(thread.get('toolu_2')).toMatchObject({ progress: { startedAt: 2 - 30_000, description: 'Wait a while' } });

        expect(thread.appendText('toolu_2', 'line1\n')).toEqual({ type: 'delta', itemId: 'toolu_2', text: 'line1\n' });
        expect(thread.appendText('toolu_2', 'line2')).not.toBeNull();
        expect(thread.get('toolu_2')).toMatchObject({ progress: { output: 'line1\nline2' } });

        // Frames for an unknown or already settled call, and a heartbeat without a usable number, change nothing.
        expect(reducer.handle({ type: 'tool_progress', tool_use_id: 'toolu_nope', elapsed_time_seconds: 1 }).events).toEqual([]);
        expect(reducer.handle({ type: 'tool_progress', tool_use_id: 'toolu_2', elapsed_time_seconds: 'soon' }).events).toEqual([]);

        reducer.handle({ type: 'user', message: { role: 'user', content: [{ tool_use_id: 'toolu_2', type: 'tool_result', content: 'ok' }] } });
        expect(thread.get('toolu_2')).toMatchObject({ state: 'done', output: 'ok' });
        expect(thread.get('toolu_2')).not.toHaveProperty('progress');
        expect(thread.appendText('toolu_2', 'late')).toBeNull();
    });

    test('a permission request becomes a pending approval and needs-you, and a cancel closes it', () => {
        const { thread, reducer } = setup();
        const out = reducer.handle({
            type: 'control_request',
            request_id: 'r1',
            request: { subtype: 'can_use_tool', tool_name: 'Edit', input: { file_path: 'a.ts' }, tool_use_id: 'toolu_9' }
        });
        expect(out.actions).toEqual([{ type: 'approval', requestId: 'r1', toolUseId: 'toolu_9', input: { file_path: 'a.ts' }, suggestions: [] }]);
        expect(thread.get('approval-r1')).toMatchObject({ canAllowAlways: false });
        expect(thread.get('approval-r1')).toMatchObject({ kind: 'approval', toolName: 'Edit', decision: 'pending' });
        expect(thread.info.status).toBe('needs-you');

        reducer.handle({ type: 'control_cancel_request', request_id: 'r1' });
        expect(thread.get('approval-r1')).toMatchObject({ decision: 'cancelled' });
        expect(thread.info.status).toBe('running');
    });

    test('AskUserQuestion becomes a question item instead of an approval', () => {
        const { thread, reducer } = setup();
        const out = reducer.handle({
            type: 'control_request',
            request_id: 'q1',
            request: {
                subtype: 'can_use_tool',
                tool_name: 'AskUserQuestion',
                input: { questions: [{ question: 'Which one?', header: 'Pick', options: [{ label: 'A', description: 'first' }], multiSelect: true }] },
                tool_use_id: 'toolu_q'
            }
        });
        expect(out.actions[0]?.type).toBe('question');
        expect(thread.get('question-q1')).toMatchObject({
            kind: 'question',
            state: 'pending',
            questions: [{ id: '0', header: 'Pick', question: 'Which one?', multiSelect: true }]
        });
        expect(thread.get('approval-q1')).toBeUndefined();
    });

    test('a compaction boundary becomes a marker with the size before it', () => {
        const { thread, reducer } = setup();
        reducer.handle({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 150000 } });
        expect(thread.list()[0]).toMatchObject({ kind: 'compaction', preTokens: 150000, turnId: 'turn-1' });
    });

    test('finish closes what is open and reports a crash', () => {
        const { thread, reducer } = setup();
        reducer.handle({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_3' } } });
        reducer.handle({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
        reducer.finish(1);
        expect(thread.get('0:msg_3:t0')).toMatchObject({ streaming: false });
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
