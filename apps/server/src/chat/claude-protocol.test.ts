import { describe, expect, test } from 'bun:test';
import { ClaudeProtocol } from './claude-protocol.ts';

const usage = { input_tokens: 8, cache_creation_input_tokens: 2671, cache_read_input_tokens: 24869, output_tokens: 1 };

describe('ClaudeProtocol', () => {
    test('the init frame reports the session, and text streams under one ref per block', () => {
        const protocol = new ClaudeProtocol();
        expect(protocol.handle({ type: 'system', subtype: 'init', session_id: 'sid', model: 'm', slash_commands: ['compact'] })).toEqual([
            { type: 'session', agentSessionId: 'sid', model: 'm', slashCommands: ['compact'] }
        ]);

        protocol.handle({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1' } } });
        expect(protocol.handle({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } })).toEqual([]);
        expect(protocol.handle({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } } })).toEqual([
            { type: 'text.delta', ref: 'msg_1:t0', text: '' }
        ]);
        expect(protocol.handle({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'po' } } })).toEqual([
            { type: 'text.delta', ref: 'msg_1:t0', text: 'po' }
        ]);
        // A block of a subagent belongs to its own tool call, not to the thread's text.
        expect(
            protocol.handle({
                type: 'stream_event',
                parent_tool_use_id: 'toolu_task',
                event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'x' } }
            })
        ).toEqual([]);

        expect(protocol.handle({ type: 'assistant', message: { id: 'msg_1', content: [{ type: 'text', text: 'pong' }], usage } })).toEqual([
            { type: 'text.done', ref: 'msg_1:t0', text: 'pong' },
            { type: 'usage', contextTokens: 27548 }
        ]);
    });

    test('a tool call and its result carry the CLI tool use id as the ref', () => {
        const protocol = new ClaudeProtocol();
        expect(
            protocol.handle({
                type: 'assistant',
                message: { id: 'msg_2', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'date' } }] }
            })
        ).toEqual([{ type: 'tool.started', ref: 'toolu_1', name: 'Bash', input: { command: 'date' }, parentRef: null }]);

        expect(
            protocol.handle({
                type: 'user',
                message: { role: 'user', content: [{ tool_use_id: 'toolu_1', type: 'tool_result', content: 'Wed Sep 9', is_error: false }] }
            })
        ).toEqual([{ type: 'tool.done', ref: 'toolu_1', output: 'Wed Sep 9', state: 'done' }]);

        const failed = protocol.handle({
            type: 'user',
            message: { role: 'user', content: [{ tool_use_id: 'toolu_1', type: 'tool_result', content: [{ type: 'text', text: 'nope' }], is_error: true }] }
        });
        expect(failed).toEqual([{ type: 'tool.done', ref: 'toolu_1', output: 'nope', state: 'error' }]);
    });

    test('a subagent tool call keeps the call that spawned it and reports no context of its own', () => {
        const protocol = new ClaudeProtocol();
        expect(
            protocol.handle({
                type: 'assistant',
                parent_tool_use_id: 'toolu_task',
                message: { id: 'msg_3', content: [{ type: 'text', text: 'inner' }, { type: 'tool_use', id: 'toolu_5', name: 'Read', input: {} }], usage }
            })
        ).toEqual([{ type: 'tool.started', ref: 'toolu_5', name: 'Read', input: {}, parentRef: 'toolu_task' }]);
    });

    test('progress frames report a description and how long a call has run', () => {
        const protocol = new ClaudeProtocol();
        expect(protocol.handle({ type: 'system', subtype: 'task_started', tool_use_id: 'toolu_2', description: 'Wait a while' })).toEqual([
            { type: 'tool.progress', ref: 'toolu_2', startedAt: null, description: 'Wait a while' }
        ]);
        const before = Date.now();
        const [progress] = protocol.handle({ type: 'tool_progress', tool_use_id: 'toolu_2', tool_name: 'Bash', elapsed_time_seconds: 30 });
        expect(progress).toMatchObject({ type: 'tool.progress', ref: 'toolu_2', description: null });
        expect(progress?.type === 'tool.progress' && progress.startedAt).toBeLessThanOrEqual(before - 30_000 + 5_000);
        // A heartbeat without a usable number says nothing.
        expect(protocol.handle({ type: 'tool_progress', tool_use_id: 'toolu_2', elapsed_time_seconds: 'soon' })).toEqual([]);
    });

    test('a permission request waits for an answer and its response carries the suggested rule', () => {
        const protocol = new ClaudeProtocol();
        const suggestions = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'date:*' }] }];
        expect(
            protocol.handle({
                type: 'control_request',
                request_id: 'r1',
                request: {
                    subtype: 'can_use_tool',
                    tool_name: 'Bash',
                    input: { command: 'date' },
                    tool_use_id: 'toolu_9',
                    description: 'Run a command',
                    permission_suggestions: suggestions
                }
            })
        ).toEqual([
            {
                type: 'approval.requested',
                requestId: 'r1',
                ref: 'toolu_9',
                toolName: 'Bash',
                input: { command: 'date' },
                description: 'Run a command',
                canAllowAlways: true
            }
        ]);

        expect(protocol.approvalResponse('nope', 'allow')).toBeNull();
        expect(protocol.approvalResponse('r1', 'allow-always')).toEqual({
            type: 'control_response',
            response: {
                subtype: 'success',
                request_id: 'r1',
                response: { behavior: 'allow', updatedInput: { command: 'date' }, toolUseID: 'toolu_9', updatedPermissions: suggestions }
            }
        });
        // Answered once; a second answer finds nothing waiting.
        expect(protocol.approvalResponse('r1', 'allow')).toBeNull();
    });

    test('a decline carries the reason the person typed', () => {
        const protocol = new ClaudeProtocol();
        protocol.handle({
            type: 'control_request',
            request_id: 'r2',
            request: { subtype: 'can_use_tool', tool_name: 'Bash', input: {}, tool_use_id: 'toolu_1' }
        });
        expect(protocol.approvalResponse('r2', 'deny', 'not that')).toMatchObject({
            response: { response: { behavior: 'deny', message: 'not that' } }
        });
    });

    test('AskUserQuestion becomes a question, answered by id and sent back keyed by text', () => {
        const protocol = new ClaudeProtocol();
        const events = protocol.handle({
            type: 'control_request',
            request_id: 'q1',
            request: {
                subtype: 'can_use_tool',
                tool_name: 'AskUserQuestion',
                input: { questions: [{ question: 'Which one?', header: 'Pick', options: [{ label: 'A', description: 'first' }], multiSelect: true }] },
                tool_use_id: 'toolu_q'
            }
        });
        expect(events).toEqual([
            {
                type: 'question.requested',
                requestId: 'q1',
                questions: [{ id: '0', header: 'Pick', question: 'Which one?', choices: [{ label: 'A', description: 'first' }], multiSelect: true }]
            }
        ]);
        expect(protocol.questionResponse('q1', { '0': 'A' })).toMatchObject({
            response: { response: { behavior: 'allow', updatedInput: { answers: { 'Which one?': 'A' } }, toolUseID: 'toolu_q' } }
        });
    });

    test('a cancelled request is taken back', () => {
        const protocol = new ClaudeProtocol();
        protocol.handle({ type: 'control_request', request_id: 'r3', request: { subtype: 'can_use_tool', tool_name: 'Edit', input: {} } });
        expect(protocol.handle({ type: 'control_cancel_request', request_id: 'r3' })).toEqual([{ type: 'request.withdrawn', requestId: 'r3' }]);
        expect(protocol.approvalResponse('r3', 'allow')).toBeNull();
    });

    test('the result frame ends the turn with the cost and the context window', () => {
        const protocol = new ClaudeProtocol();
        protocol.handle({ type: 'system', subtype: 'init', session_id: 'sid', model: 'm' });
        expect(
            protocol.handle({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.02, modelUsage: { m: { contextWindow: 200000 } } })
        ).toEqual([
            { type: 'usage', contextWindow: 200000 },
            { type: 'turn.done', state: 'done', costUsd: 0.02 }
        ]);
        expect(protocol.handle({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['out of tokens'] })).toEqual([
            { type: 'turn.done', state: 'error', costUsd: 0, error: 'out of tokens' }
        ]);
    });

    test('a compaction boundary reports the size before the fold', () => {
        const protocol = new ClaudeProtocol();
        expect(protocol.handle({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 150000 } })).toEqual([
            { type: 'compaction', preTokens: 150000 }
        ]);
    });

    test('frames it does not know say nothing', () => {
        const protocol = new ClaudeProtocol();
        expect(protocol.handle({ type: 'rate_limit_event' })).toEqual([]);
        expect(protocol.handle('junk')).toEqual([]);
    });
});
