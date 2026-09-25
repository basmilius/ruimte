import { describe, expect, jest, test } from 'bun:test';
import { ClaudeProtocol } from './claude-protocol.ts';

const usage = { input_tokens: 8, cache_creation_input_tokens: 2671, cache_read_input_tokens: 24869, output_tokens: 1 };

describe('ClaudeProtocol', () => {
    test('the init frame reports the session, and text streams under one ref per block', () => {
        const protocol = new ClaudeProtocol();
        expect(protocol.handle({ type: 'system', subtype: 'init', session_id: 'sid', model: 'm', slash_commands: ['compact'], skills: ['unslop'] })).toEqual([
            { type: 'session', agentSessionId: 'sid', model: 'm', slashCommands: ['compact'], skills: ['unslop'] }
        ]);

        protocol.handle({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1' } } });
        expect(protocol.handle({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } })).toEqual([
            { type: 'thinking.delta', ref: 'msg_1:k0', text: '' }
        ]);
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

    test('a subagent frame keeps the call that spawned it and reports no context of its own', () => {
        const protocol = new ClaudeProtocol();
        expect(
            protocol.handle({
                type: 'assistant',
                parent_tool_use_id: 'toolu_task',
                message: {
                    id: 'msg_3',
                    content: [
                        { type: 'text', text: 'inner' },
                        { type: 'tool_use', id: 'toolu_5', name: 'Read', input: {} }
                    ],
                    usage
                }
            })
        ).toEqual([
            // The subagent's own text is its report, not the thread's answer.
            { type: 'text.done', ref: 'msg_3:t0', text: 'inner', parentRef: 'toolu_task' },
            { type: 'tool.started', ref: 'toolu_5', name: 'Read', input: {}, parentRef: 'toolu_task' }
        ]);
    });

    test('a delegation reports itself as a task, with what it is and what it spends', () => {
        const protocol = new ClaudeProtocol();
        expect(
            protocol.handle({
                type: 'assistant',
                message: {
                    id: 'msg_4',
                    content: [
                        {
                            type: 'tool_use',
                            id: 'toolu_agent',
                            name: 'Agent',
                            input: { description: 'Run sleep', subagent_type: 'general-purpose', prompt: 'sleep 20', run_in_background: true }
                        }
                    ]
                }
            })
        ).toEqual([
            {
                type: 'tool.started',
                ref: 'toolu_agent',
                name: 'Agent',
                input: { description: 'Run sleep', subagent_type: 'general-purpose', prompt: 'sleep 20', run_in_background: true },
                parentRef: null
            }
        ]);

        expect(
            protocol.handle({
                type: 'system',
                subtype: 'task_started',
                task_id: 'a3838cf8b1de992a3',
                tool_use_id: 'toolu_agent',
                description: 'Run sleep',
                subagent_type: 'general-purpose',
                is_backgrounded: true,
                spawn_depth: 1,
                task_type: 'local_agent',
                prompt: 'sleep 20'
            })
        ).toEqual([
            {
                type: 'task.started',
                ref: 'toolu_agent',
                taskId: 'a3838cf8b1de992a3',
                description: 'Run sleep',
                subagentType: 'general-purpose',
                prompt: 'sleep 20',
                background: true,
                depth: 1
            }
        ]);

        expect(
            protocol.handle({
                type: 'system',
                subtype: 'task_progress',
                task_id: 'a3838cf8b1de992a3',
                tool_use_id: 'toolu_agent',
                description: 'Running Sleep for 20 seconds',
                subagent_type: 'general-purpose',
                usage: { total_tokens: 15074, tool_uses: 1, duration_ms: 2575 },
                last_tool_name: 'Bash'
            })
        ).toEqual([
            {
                type: 'task.progress',
                ref: 'toolu_agent',
                taskId: 'a3838cf8b1de992a3',
                summary: 'Running Sleep for 20 seconds',
                lastTool: 'Bash',
                usage: { totalTokens: 15074, toolUses: 1, durationMs: 2575 }
            }
        ]);
    });

    test('progress frames report a description and how long a call has run', () => {
        const protocol = new ClaudeProtocol();
        expect(protocol.handle({ type: 'system', subtype: 'task_started', tool_use_id: 'toolu_2', description: 'Wait a while' })).toEqual([
            { type: 'tool.progress', ref: 'toolu_2', startedAt: null, description: 'Wait a while' }
        ]);
        // A clock that stands still, so the start is exactly thirty seconds back however slow the runner is.
        jest.useFakeTimers();
        try {
            const now = Date.now();
            const [progress] = protocol.handle({ type: 'tool_progress', tool_use_id: 'toolu_2', tool_name: 'Bash', elapsed_time_seconds: 30 });
            expect(progress).toMatchObject({ type: 'tool.progress', ref: 'toolu_2', description: null });
            expect(progress?.type === 'tool.progress' && progress.startedAt).toBe(now - 30_000);
        } finally {
            jest.useRealTimers();
        }
        expect(protocol.handle({ type: 'tool_progress', tool_use_id: 'toolu_2', elapsed_time_seconds: 'soon' })).toEqual([]);
        // A background subagent reports through task_progress instead.
        expect(protocol.handle({ type: 'system', subtype: 'task_progress', tool_use_id: 'toolu_3', description: 'Running Sleep for 20 seconds' })).toEqual([
            { type: 'tool.progress', ref: 'toolu_3', startedAt: null, description: 'Running Sleep for 20 seconds' }
        ]);
    });

    test('a task notification carries what the background task came to', () => {
        const protocol = new ClaudeProtocol();
        expect(
            protocol.handle({
                type: 'system',
                subtype: 'task_notification',
                task_id: 'a3838cf8b1de992a3',
                tool_use_id: 'toolu_agent',
                status: 'completed',
                output_file: '/tmp/tasks/a3838cf8b1de992a3.output',
                summary: 'slept',
                usage: { total_tokens: 16464, tool_uses: 1, duration_ms: 24235 }
            })
        ).toEqual([
            {
                type: 'task.done',
                ref: 'toolu_agent',
                taskId: 'a3838cf8b1de992a3',
                summary: 'slept',
                ok: true,
                usage: { totalTokens: 16464, toolUses: 1, durationMs: 24235 },
                outputFile: '/tmp/tasks/a3838cf8b1de992a3.output'
            }
        ]);
        // A task that ended another way is still the thing that wakes the agent.
        expect(protocol.handle({ type: 'system', subtype: 'task_notification', task_id: 't', status: 'failed', summary: 'no luck' })).toEqual([
            { type: 'task.done', ref: null, taskId: 't', summary: 'no luck', ok: false, usage: null, outputFile: null }
        ]);
        // Claude Code 2.1.273 says `stopped` for a task that was killed, with its own id and nothing it wrote.
        expect(
            protocol.handle({
                type: 'system',
                subtype: 'task_notification',
                task_id: 'a91114f36f4c6b0ef',
                tool_use_id: 'toolu_01GNbHkKfS9B2cD6q6SRC9cQ',
                status: 'stopped',
                output_file: '',
                summary: 'Merge-readiness review',
                skip_transcript: false
            })
        ).toEqual([
            {
                type: 'task.done',
                ref: 'toolu_01GNbHkKfS9B2cD6q6SRC9cQ',
                taskId: 'a91114f36f4c6b0ef',
                summary: 'Merge-readiness review',
                ok: false,
                usage: null,
                outputFile: null
            }
        ]);
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
                canAllowAlways: true,
                allowAlways: { label: 'Allow with these rules', description: JSON.stringify(suggestions, null, 2) }
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

    test("a background agent's request outlives the result, and a decline turns it down under the agent's own call", () => {
        const protocol = new ClaudeProtocol();
        protocol.handle({
            type: 'control_request',
            request_id: 'r4',
            request: {
                subtype: 'can_use_tool',
                tool_name: 'AskUserQuestion',
                input: { questions: [{ question: 'Which?', options: [] }] },
                tool_use_id: 'toolu_q',
                agent_id: 'a-1'
            }
        });
        protocol.handle({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0 });
        expect(protocol.declineResponse('r4', 'The user stopped the turn')).toEqual({
            type: 'control_response',
            response: { subtype: 'success', request_id: 'r4', response: { behavior: 'deny', message: 'The user stopped the turn', toolUseID: 'toolu_q' } }
        });
        expect(protocol.declineResponse('r4', 'again')).toBeNull();
    });

    test('the result frame ends the turn with the cost, and the window it reports is left alone', () => {
        const protocol = new ClaudeProtocol();
        protocol.handle({ type: 'system', subtype: 'init', session_id: 'sid', model: 'm' });
        // `modelUsage.contextWindow` is the model's maximum even on a run without `[1m]`, so nothing reads it.
        expect(
            protocol.handle({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.02, modelUsage: { m: { contextWindow: 1000000 } } })
        ).toEqual([{ type: 'turn.done', state: 'done', costUsd: 0.02 }]);
        expect(protocol.handle({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['out of tokens'] })).toEqual([
            { type: 'turn.done', state: 'error', costUsd: 0, error: 'out of tokens' }
        ]);
    });

    test('the turn ends on the uuid of its last main-chain assistant frame, which a subagent frame does not move', () => {
        const protocol = new ClaudeProtocol();
        protocol.handle({ type: 'assistant', uuid: 'u-1', message: { id: 'm1', content: [{ type: 'text', text: 'first' }] } });
        protocol.handle({ type: 'assistant', uuid: 'u-2', message: { id: 'm2', content: [{ type: 'text', text: 'last' }] } });
        protocol.handle({ type: 'assistant', uuid: 'u-sub', parent_tool_use_id: 'toolu_9', message: { id: 'm3', content: [{ type: 'text', text: 'sub' }] } });
        expect(protocol.handle({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0 })).toEqual([
            { type: 'turn.done', state: 'done', costUsd: 0, native: { lastUuid: 'u-2' } }
        ]);
        // A turn without an answer of its own does not inherit the one before it.
        expect(protocol.handle({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0 })).toEqual([
            { type: 'turn.done', state: 'done', costUsd: 0 }
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

    // The frames Claude Code 2.1.281 writes when the API turns a request away.
    const refused = (protocol: ClaudeProtocol, error: string, text: string): unknown[] => {
        protocol.handle({ type: 'assistant', uuid: 'u-1', message: { id: 'm1', model: '<synthetic>', content: [{ type: 'text', text }] }, error });
        return protocol.handle({ type: 'result', subtype: 'success', is_error: true, api_error_status: 429, result: text, total_cost_usd: 0 });
    };

    test('a turn a spent window of the plan refused ends with a usage limit and its reset', () => {
        const protocol = new ClaudeProtocol();
        protocol.handle({
            type: 'rate_limit_event',
            rate_limit_info: { status: 'rejected', resetsAt: 1_789_000_000, rateLimitType: 'five_hour', utilization: 1 }
        });
        expect(refused(protocol, 'rate_limit', "You've hit your session limit · resets 3pm")).toEqual([
            {
                type: 'turn.done',
                state: 'error',
                costUsd: 0,
                error: "You've hit your session limit · resets 3pm",
                native: { lastUuid: 'u-1' },
                limit: { kind: 'usage', resetsAt: 1_789_000_000_000 }
            }
        ]);
        // What the turn heard is its own: the next one fails for another reason and names no limit.
        expect(protocol.handle({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['boom'] })).toEqual([
            { type: 'turn.done', state: 'error', costUsd: 0, error: 'boom' }
        ]);
    });

    test('an overloaded model, or a 429 the plan did not explain, is an overload without a reset', () => {
        const protocol = new ClaudeProtocol();
        expect(refused(protocol, 'overloaded', 'API Error: Repeated 529 Overloaded errors')).toMatchObject([{ state: 'error', limit: { kind: 'overload' } }]);
        protocol.handle({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1_789_000_000, rateLimitType: 'five_hour' } });
        protocol.handle({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: 1_789_000_000, rateLimitType: 'five_hour' } });
        expect(refused(protocol, 'rate_limit', 'Request rejected (429)')).toMatchObject([{ state: 'error', limit: { kind: 'overload' } }]);
    });

    test('a refused window on a turn that still answered is no limit', () => {
        const protocol = new ClaudeProtocol();
        protocol.handle({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1_789_000_000, rateLimitType: 'five_hour' } });
        expect(protocol.handle({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0 })).toEqual([
            { type: 'turn.done', state: 'done', costUsd: 0 }
        ]);
    });

    test('what a turn says about the plan leaves the chat as a limits event', () => {
        const protocol = new ClaudeProtocol();
        expect(
            protocol.handle({ type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'five_hour', utilization: 0.31, resetsAt: 1_789_000_000 } })
        ).toEqual([
            {
                type: 'limits',
                update: {
                    kind: 'claude',
                    windows: [{ id: 'five_hour', label: 'Session', kind: 'session', durationMs: 18_000_000, used: 0.31, resetsAt: 1_789_000_000_000 }]
                }
            }
        ]);
    });

    test('a command or a monitor in the background is started once and ended by whatever says so first', () => {
        const protocol = new ClaudeProtocol();
        const started = (taskId: string, extra: Record<string, unknown>) =>
            protocol.handle({ type: 'system', subtype: 'task_started', task_id: taskId, description: 'Watch the build', ...extra });
        expect(started('b1', { task_type: 'local_bash', tool_use_id: 'toolu_b1', is_backgrounded: true })).toEqual([
            { type: 'background.started', taskId: 'b1', ref: 'toolu_b1', monitor: false, description: 'Watch the build' },
            { type: 'tool.progress', ref: 'toolu_b1', startedAt: null, description: 'Watch the build' }
        ]);
        // A plugin's monitor has no call behind it, and an ambient one is the CLI's own business.
        expect(started('m1', { task_type: 'monitor_mcp' })).toEqual([
            { type: 'background.started', taskId: 'm1', ref: null, monitor: true, description: 'Watch the build' }
        ]);
        expect(started('m2', { task_type: 'monitor_ws', ambient: true })).toEqual([]);
        expect(protocol.handle({ type: 'system', subtype: 'task_updated', task_id: 'b1', patch: { status: 'killed' } })).toEqual([
            { type: 'background.ended', taskId: 'b1' }
        ]);
        expect(protocol.handle({ type: 'system', subtype: 'task_notification', task_id: 'b1', status: 'killed' })).toEqual([
            { type: 'task.done', ref: null, taskId: 'b1', summary: null, ok: false, usage: null, outputFile: null }
        ]);
        expect(protocol.handle({ type: 'system', subtype: 'task_notification', task_id: 'm1', status: 'completed' })[0]).toEqual({
            type: 'background.ended',
            taskId: 'm1'
        });
    });

    test('a foreground command joins the background only once the CLI moves it there', () => {
        const protocol = new ClaudeProtocol();
        expect(
            protocol.handle({
                type: 'system',
                subtype: 'task_started',
                task_id: 'b2',
                task_type: 'local_bash',
                tool_use_id: 'toolu_b2',
                is_backgrounded: false
            })
        ).toEqual([]);
        expect(
            protocol.handle({ type: 'system', subtype: 'task_updated', task_id: 'b2', patch: { is_backgrounded: true, description: 'Run the tests' } })
        ).toEqual([{ type: 'background.started', taskId: 'b2', ref: 'toolu_b2', monitor: false, description: 'Run the tests' }]);
        expect(protocol.stopTaskRequest('b2')).toMatchObject({ type: 'control_request', request: { subtype: 'stop_task', task_id: 'b2' } });
    });

    // The launch text is what Claude Code 2.1.273 and 2.1.274 wrote to their transcripts; 2.1.282 still carries it and ends the task this way.
    test('a workflow ends on whichever says so first, its task status or its notification', () => {
        const launch = (protocol: ClaudeProtocol) =>
            protocol.handle({
                type: 'user',
                message: {
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: 'toolu_wf',
                            content: 'Workflow launched in background. Task ID: wtbdiuq1l\nSummary: Review the PR\nRun ID: wf_230f9737-7f9'
                        }
                    ]
                }
            });
        const byStatus = new ClaudeProtocol();
        expect(launch(byStatus)).toEqual([
            { type: 'tool.done', ref: 'toolu_wf', output: expect.stringMatching(/^Workflow launched in background/), state: 'done' }
        ]);
        expect(byStatus.handle({ type: 'system', subtype: 'task_updated', task_id: 'wtbdiuq1l', patch: { status: 'failed' } })).toEqual([
            { type: 'task.done', ref: 'toolu_wf', taskId: 'wtbdiuq1l', summary: null, ok: false }
        ]);
        expect(byStatus.handle({ type: 'system', subtype: 'task_updated', task_id: 'wtbdiuq1l', patch: { status: 'failed' } })).toEqual([]);

        const byNotification = new ClaudeProtocol();
        byNotification.handle({
            type: 'system',
            subtype: 'task_started',
            task_id: 'w2',
            tool_use_id: 'toolu_wf2',
            description: 'Review the PR',
            task_type: 'local_workflow',
            workflow_name: 'review'
        });
        const summary = 'Dynamic workflow "Review the PR" completed';
        expect(
            byNotification.handle({ type: 'system', subtype: 'task_notification', task_id: 'w2', tool_use_id: 'toolu_wf2', status: 'completed', summary })
        ).toEqual([{ type: 'task.done', ref: 'toolu_wf2', taskId: 'w2', summary, ok: true, usage: null, outputFile: null }]);
        expect(byNotification.handle({ type: 'system', subtype: 'task_updated', task_id: 'w2', patch: { status: 'completed' } })).toEqual([]);
    });

    // As Claude Code 2.1.282 streamed a two-phase workflow, trimmed to what is read.
    test("a workflow's progress is its phases and agents, whole, from the frames that carry it", () => {
        const protocol = new ClaudeProtocol();
        expect(
            protocol.handle({
                type: 'system',
                subtype: 'task_started',
                task_id: 'w4u5arky1',
                tool_use_id: 'toolu_wf',
                description: 'Write alpha to a.txt in phase 1, then read it in phase 2',
                task_type: 'local_workflow',
                workflow_name: 'write-and-read-workflow'
            })
        ).toEqual([
            { type: 'workflow.progress', ref: 'toolu_wf', workflow: { name: 'write-and-read-workflow', phases: [], agents: [] } },
            { type: 'tool.progress', ref: 'toolu_wf', startedAt: null, description: 'Write alpha to a.txt in phase 1, then read it in phase 2' }
        ]);
        const progress = (extra: Record<string, unknown>) =>
            protocol.handle({
                type: 'system',
                subtype: 'task_progress',
                task_id: 'w4u5arky1',
                tool_use_id: 'toolu_wf',
                description: 'Read: read-file',
                usage: { total_tokens: 32403, tool_uses: 2, duration_ms: 9188 },
                last_tool_name: 'read-file',
                ...extra
            });
        // Most frames only count; they say nothing about the phases.
        expect(progress({})).toEqual([{ type: 'tool.progress', ref: 'toolu_wf', startedAt: null, description: 'Read: read-file' }]);
        expect(
            progress({
                workflow_progress: [
                    { type: 'workflow_phase', index: 2, title: 'Read' },
                    { type: 'workflow_phase', index: 1, title: 'Write' },
                    { type: 'workflow_log', message: 'phase 2' },
                    {
                        type: 'workflow_agent',
                        index: 2,
                        label: 'read-file',
                        phaseIndex: 2,
                        phaseTitle: 'Read',
                        agentId: 'a39a837ca1c2b3767',
                        model: 'claude-haiku-4-5',
                        state: 'start',
                        startedAt: 1790321947950,
                        queuedAt: 1790321947949
                    },
                    {
                        type: 'workflow_agent',
                        index: 1,
                        label: 'write-file',
                        phaseIndex: 1,
                        phaseTitle: 'Write',
                        agentId: 'a8a14782f2a71dcab',
                        state: 'done',
                        startedAt: 1790321942528,
                        lastToolName: 'Write',
                        tokens: 16264,
                        toolCalls: 1,
                        durationMs: 5421
                    },
                    { type: 'workflow_agent', index: 3, label: 'check', phaseIndex: 2, state: 'error', error: 'blocked', queuedAt: 1790321947960 }
                ]
            })[0]
        ).toEqual({
            type: 'workflow.progress',
            ref: 'toolu_wf',
            workflow: {
                name: null,
                phases: [
                    { index: 1, title: 'Write' },
                    { index: 2, title: 'Read' }
                ],
                agents: [
                    {
                        index: 1,
                        label: 'write-file',
                        phaseIndex: 1,
                        agentId: 'a8a14782f2a71dcab',
                        status: 'done',
                        startedAt: 1790321942528,
                        durationMs: 5421,
                        lastTool: 'Write'
                    },
                    {
                        index: 2,
                        label: 'read-file',
                        phaseIndex: 2,
                        agentId: 'a39a837ca1c2b3767',
                        status: 'running',
                        startedAt: 1790321947950,
                        durationMs: null,
                        lastTool: null
                    },
                    { index: 3, label: 'check', phaseIndex: 2, agentId: null, status: 'failed', startedAt: null, durationMs: null, lastTool: null }
                ]
            }
        });
    });
});
