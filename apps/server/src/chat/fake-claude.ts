/*
 * Network-free Claude stream-json fake. Prompt commands exercise permissions, tools, questions,
 * compaction, edits, subagents, interrupts and crashes through the real frame shapes.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runOverStdio, type FakeCli } from './fake-cli.ts';

export const fakeClaude: FakeCli = (io) => {
    const args = io.argv;
    const resumeAt = args.indexOf('--resume');
    const sessionId = resumeAt >= 0 ? args[resumeAt + 1]! : `fake-${Math.random().toString(36).slice(2, 8)}`;
    const modelAt = args.indexOf('--model');
    const model = modelAt >= 0 ? args[modelAt + 1]! : 'fake-model';
    const out = io.out;

    let messageCounter = 0;
    // A real message id is unique across processes, which a fork's thread holding a resumed CLI's replies relies on.
    const nonce = Math.random().toString(36).slice(2, 6);
    const usage = { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 5 };

    const assistantText = (text: string): void => {
        const id = `msg_${nonce}_${++messageCounter}`;
        out({ type: 'stream_event', event: { type: 'message_start', message: { id, model } }, session_id: sessionId });
        out({
            type: 'stream_event',
            event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
            session_id: sessionId
        });
        out({
            type: 'stream_event',
            event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'weighing it' } },
            session_id: sessionId
        });
        out({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 }, session_id: sessionId });
        out({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }, session_id: sessionId });
        const half = Math.ceil(text.length / 2);
        out({
            type: 'stream_event',
            event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(0, half) } },
            session_id: sessionId
        });
        out({
            type: 'stream_event',
            event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(half) } },
            session_id: sessionId
        });
        // Every frame carries the uuid of its line in the transcript, which is what a fork is cut at.
        out({
            type: 'assistant',
            uuid: `${id}-thinking`,
            message: { id, model, role: 'assistant', content: [{ type: 'thinking', thinking: '' }], usage },
            session_id: sessionId
        });
        out({
            type: 'assistant',
            uuid: `${id}-text`,
            message: { id, model, role: 'assistant', content: [{ type: 'text', text }], usage },
            session_id: sessionId
        });
        out({ type: 'stream_event', event: { type: 'message_stop' }, session_id: sessionId });
    };

    const result = (): void => {
        out({
            type: 'result',
            subtype: 'success',
            is_error: false,
            num_turns: 1,
            total_cost_usd: 0.01,
            usage,
            // The window the CLI reports follows the `[1m]` it was started with, as the real one does.
            modelUsage: { [model]: { contextWindow: model.endsWith('[1m]') ? 1000000 : 200000 } },
            session_id: sessionId
        });
    };

    // What a subagent's own work looks like on the wire: frames of its own, under the call that spawned it.
    const subagentWork = (agentToolUseId: string, report: string): void => {
        const child = (content: unknown[]): void => {
            out({
                type: 'assistant',
                message: { id: `msg_${nonce}_${++messageCounter}`, model, role: 'assistant', content, usage },
                parent_tool_use_id: agentToolUseId,
                subagent_type: 'general-purpose',
                session_id: sessionId
            });
        };
        const childResult = (toolUseId: string, content: string): void => {
            out({
                type: 'user',
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: false }] },
                parent_tool_use_id: agentToolUseId,
                session_id: sessionId
            });
        };
        child([{ type: 'tool_use', id: `${agentToolUseId}_read`, name: 'Read', input: { file_path: 'README.md' } }]);
        childResult(`${agentToolUseId}_read`, '# Ruimte');
        child([{ type: 'tool_use', id: `${agentToolUseId}_bash`, name: 'Bash', input: { command: 'ls', description: 'List files' } }]);
        childResult(`${agentToolUseId}_bash`, 'README.md');
        out({
            type: 'system',
            subtype: 'task_progress',
            task_id: `task-${agentToolUseId}`,
            tool_use_id: agentToolUseId,
            description: 'Running List files',
            subagent_type: 'general-purpose',
            usage: { total_tokens: 1500, tool_uses: 2, duration_ms: 250 },
            last_tool_name: 'Bash',
            session_id: sessionId
        });
        child([{ type: 'text', text: report }]);
    };

    // The footer the CLI appends to a foreground report, in its own words.
    const agentFooter = (agentId: string): string =>
        `\n\nagentId: ${agentId} (use SendMessage with to: '${agentId}', summary: 'the report' to continue this agent)\n<usage>subagent_tokens: 1500\ntool_uses: 2\nduration_ms: 250</usage>`;

    let pendingApproval: { command: string } | null = null;
    let pendingQuestion: string | null = null;
    let slow = false;

    const handleUser = (text: string): void => {
        if (text === 'crash') {
            io.exit(1);
            return;
        }
        // A line of its own, so a prompt with a task brief under it or a message above it still waits.
        if (text.split('\n').some((line) => line === 'slow')) {
            slow = true;
            out({ type: 'stream_event', event: { type: 'message_start', message: { id: `msg_${nonce}_${++messageCounter}`, model } }, session_id: sessionId });
            return;
        }
        if (text === 'compact') {
            out({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: 5000 }, session_id: sessionId });
            assistantText('compacted');
            result();
            return;
        }
        if (text.startsWith('ask:')) {
            const question = text.slice(4).trim();
            pendingQuestion = question;
            out({
                type: 'control_request',
                request_id: 'req-q',
                request: {
                    subtype: 'can_use_tool',
                    tool_name: 'AskUserQuestion',
                    input: {
                        questions: [
                            {
                                question,
                                header: 'Choice',
                                options: [
                                    { label: 'Red', description: 'Warm' },
                                    { label: 'Blue', description: 'Cool' }
                                ],
                                multiSelect: false
                            }
                        ]
                    },
                    tool_use_id: 'toolu_q'
                }
            });
            return;
        }
        if (text.startsWith('write:')) {
            const [path = '', ...rest] = text.slice(6).trim().split(' ');
            const content = `${rest.join(' ')}\n`;
            // Against the CLI's own folder: in a test the fake shares the test runner's working directory.
            writeFileSync(resolve(io.cwd, path), content);
            const id = `msg_${nonce}_${++messageCounter}`;
            out({
                type: 'assistant',
                message: {
                    id,
                    model,
                    role: 'assistant',
                    content: [{ type: 'tool_use', id: 'toolu_write', name: 'Write', input: { file_path: path, content } }],
                    usage
                },
                session_id: sessionId
            });
            out({
                type: 'user',
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_write', content: `wrote ${path}`, is_error: false }] },
                session_id: sessionId
            });
            assistantText('written');
            result();
            return;
        }
        if (text.startsWith('delegate:')) {
            const description = text.slice(9).trim();
            const report = '# Report\n\n- one\n- two';
            out({
                type: 'assistant',
                message: {
                    id: `msg_${nonce}_${++messageCounter}`,
                    model,
                    role: 'assistant',
                    content: [
                        {
                            type: 'tool_use',
                            id: 'toolu_delegate',
                            name: 'Agent',
                            input: { description, subagent_type: 'general-purpose', prompt: `Do this: ${description}` }
                        }
                    ],
                    usage
                },
                session_id: sessionId
            });
            out({
                type: 'system',
                subtype: 'task_started',
                task_id: 'task-delegate',
                tool_use_id: 'toolu_delegate',
                description,
                subagent_type: 'general-purpose',
                is_backgrounded: false,
                spawn_depth: 1,
                task_type: 'local_agent',
                prompt: `Do this: ${description}`,
                session_id: sessionId
            });
            subagentWork('toolu_delegate', report);
            out({
                type: 'user',
                message: {
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: 'toolu_delegate', content: `${report}${agentFooter('agent_fake')}`, is_error: false }]
                },
                session_id: sessionId
            });
            assistantText('summarized');
            result();
            return;
        }
        if (text.startsWith('background:')) {
            const summary = text.slice(11).trim() || 'done';
            const id = `msg_${nonce}_${++messageCounter}`;
            out({
                type: 'assistant',
                message: {
                    id,
                    model,
                    role: 'assistant',
                    content: [
                        { type: 'tool_use', id: 'toolu_agent', name: 'Agent', input: { description: summary, prompt: summary, run_in_background: true } }
                    ],
                    usage
                },
                session_id: sessionId
            });
            out({
                type: 'system',
                subtype: 'task_started',
                task_id: 'task-agent',
                tool_use_id: 'toolu_agent',
                description: summary,
                subagent_type: 'general-purpose',
                is_backgrounded: true,
                task_type: 'local_agent',
                session_id: sessionId
            });
            out({
                type: 'user',
                message: {
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: 'toolu_agent', content: 'Async agent launched successfully.', is_error: false }]
                },
                session_id: sessionId
            });
            assistantText('I will report back');
            result();
            // What the real CLI does after the turn ended: no user frame, a notification, a fresh init,
            // an assistant message of its own and a result.
            io.later(() => {
                subagentWork('toolu_agent', `the subagent says: ${summary}`);
                out({
                    type: 'system',
                    subtype: 'task_notification',
                    task_id: 'task-agent',
                    tool_use_id: 'toolu_agent',
                    status: 'completed',
                    output_file: '',
                    summary,
                    usage: { total_tokens: 1500, tool_uses: 2, duration_ms: 250 },
                    session_id: sessionId
                });
                out({ type: 'system', subtype: 'init', session_id: sessionId, model, cwd: io.cwd, tools: ['Bash'], slash_commands: [], argv: args });
                assistantText(`the subagent says: ${summary}`);
                result();
            });
            return;
        }
        if (text.startsWith('run:')) {
            const command = text.slice(4).trim();
            const id = `msg_${nonce}_${++messageCounter}`;
            out({
                type: 'assistant',
                message: { id, model, role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_run', name: 'Bash', input: { command } }], usage },
                session_id: sessionId
            });
            // The frames the real CLI emits around a long Bash call, in its order and shape.
            out({
                type: 'system',
                subtype: 'task_started',
                task_id: 'task-1',
                tool_use_id: 'toolu_run',
                description: `Run ${command}`,
                is_backgrounded: false,
                task_type: 'local_bash',
                session_id: sessionId
            });
            out({
                type: 'tool_progress',
                tool_use_id: 'toolu_run',
                tool_name: 'Bash',
                parent_tool_use_id: null,
                elapsed_time_seconds: 30,
                task_id: 'task-1',
                session_id: sessionId
            });
            out({
                type: 'system',
                subtype: 'task_notification',
                task_id: 'task-1',
                tool_use_id: 'toolu_run',
                status: 'completed',
                output_file: '',
                summary: `Run ${command}`,
                session_id: sessionId
            });
            out({
                type: 'user',
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_run', content: `ran: ${command}`, is_error: false }] },
                session_id: sessionId
            });
            assistantText('done');
            result();
            return;
        }
        if (text.startsWith('tool:')) {
            const command = text.slice(5).trim();
            const id = `msg_${nonce}_${++messageCounter}`;
            out({
                type: 'assistant',
                message: { id, model, role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command } }], usage },
                session_id: sessionId
            });
            pendingApproval = { command };
            out({
                type: 'control_request',
                request_id: 'req-1',
                request: {
                    subtype: 'can_use_tool',
                    tool_name: 'Bash',
                    input: { command },
                    tool_use_id: 'toolu_1',
                    description: 'Run a command',
                    permission_suggestions: [
                        { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: `${command}:*` }], behavior: 'allow', destination: 'session' }
                    ]
                }
            });
            return;
        }
        if (text === 'system?') {
            const at = args.indexOf('--append-system-prompt');
            assistantText(at >= 0 ? args[at + 1]! : 'none');
            result();
            return;
        }
        assistantText(`echo: ${text}`);
        result();
    };

    const handleControlResponse = (response: Record<string, unknown>): void => {
        const inner = response.response as
            | { behavior?: string; updatedInput?: { answers?: Record<string, string> }; updatedPermissions?: unknown[] }
            | undefined;
        if (pendingQuestion) {
            const answer = inner?.updatedInput?.answers?.[pendingQuestion] ?? 'no answer';
            pendingQuestion = null;
            assistantText(`you chose ${answer}`);
            result();
            return;
        }
        const approval = pendingApproval;
        pendingApproval = null;
        if (!approval) {
            return;
        }
        if (inner?.behavior === 'allow') {
            const always = Array.isArray(inner.updatedPermissions) && inner.updatedPermissions.length > 0;
            out({
                type: 'user',
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: `ran: ${approval.command}`, is_error: false }] },
                session_id: sessionId
            });
            assistantText(always ? 'done, remembered' : 'done');
        } else {
            out({
                type: 'user',
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'denied by user', is_error: true }] },
                session_id: sessionId
            });
            assistantText('denied');
        }
        result();
    };

    out({ type: 'system', subtype: 'init', session_id: sessionId, model, cwd: io.cwd, tools: ['Bash'], slash_commands: ['compact', 'review'], argv: args });

    return {
        onLine: (line) => {
            const frame = JSON.parse(line) as Record<string, unknown>;
            if (frame.type === 'user') {
                const message = frame.message as { content: Array<{ text: string }> };
                handleUser(message.content[0]?.text ?? '');
            } else if (frame.type === 'control_response') {
                handleControlResponse(frame.response as Record<string, unknown>);
            } else if (frame.type === 'control_request') {
                const request = frame.request as { subtype: string };
                out({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id, response: {} } });
                if (request.subtype === 'interrupt' && slow) {
                    slow = false;
                    assistantText('[interrupted]');
                    result();
                }
            }
        }
    };
};

if (import.meta.main) {
    await runOverStdio(fakeClaude);
}
