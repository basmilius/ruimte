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
            // The real CLI reports the model's maximum here whatever `[1m]` said, so the fake does too.
            modelUsage: { [model]: { contextWindow: 1000000 } },
            session_id: sessionId
        });
    };

    // A request the API turned away: a synthetic message with the reason, then a result that failed without saying which error.
    const refusal = (text: string, error: string, status: number): void => {
        const id = `msg_${nonce}_${++messageCounter}`;
        out({
            type: 'assistant',
            uuid: `${id}-text`,
            message: { id, model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text }] },
            parent_tool_use_id: null,
            error,
            session_id: sessionId
        });
        out({
            type: 'result',
            subtype: 'success',
            is_error: true,
            api_error_status: status,
            result: text,
            num_turns: 1,
            total_cost_usd: 0,
            usage,
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
        if (text === 'crash loudly') {
            io.err(`${'warming up\n'.repeat(2000)}Error: the fake lost its key\n    at handleUser (fake-claude.ts)\n`);
            io.exit(1);
            return;
        }
        // Over stdio only: a process of the CLI's own, as a dev server an agent started would be.
        if (text === 'start a grandchild') {
            const grandchild = Bun.spawn(['sleep', '600'], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
            assistantText(`grandchild ${grandchild.pid}`);
            result();
            return;
        }
        // A line of its own, so a prompt with a task brief under it or a message above it still waits.
        if (text.split('\n').some((line) => line === 'slow')) {
            slow = true;
            out({ type: 'stream_event', event: { type: 'message_start', message: { id: `msg_${nonce}_${++messageCounter}`, model } }, session_id: sessionId });
            return;
        }
        // Lines of their own, as the two ways Claude Code 2.1.281 ends a turn it could not get an answer for.
        const limit = text.split('\n').find((line) => line.startsWith('limit:'));
        if (limit !== undefined) {
            const resetsAt = Number(limit.slice(6));
            out({
                type: 'rate_limit_event',
                rate_limit_info: { status: 'rejected', resetsAt, rateLimitType: 'five_hour', utilization: 1 },
                uuid: `rate-${nonce}`,
                session_id: sessionId
            });
            refusal("You've hit your session limit · resets 3pm", 'rate_limit', 429);
            return;
        }
        // A line of its own as well: a tool call whose result is that many bytes, the way a long log or a big file reads back.
        const output = text.split('\n').find((line) => line.startsWith('output:'));
        if (output !== undefined) {
            const bytes = Number(output.slice(7));
            const toolUseId = `toolu_${nonce}_${++messageCounter}`;
            out({
                type: 'assistant',
                message: {
                    id: `msg_${nonce}_${messageCounter}`,
                    model,
                    role: 'assistant',
                    content: [{ type: 'tool_use', id: toolUseId, name: 'Bash', input: { command: 'cat build.log' } }],
                    usage
                },
                session_id: sessionId
            });
            const line = 'build step finished without warnings\n';
            out({
                type: 'user',
                message: {
                    role: 'user',
                    content: [
                        { type: 'tool_result', tool_use_id: toolUseId, content: line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes), is_error: false }
                    ]
                },
                session_id: sessionId
            });
            assistantText(`read ${bytes} bytes of build log`);
            result();
            return;
        }
        if (text.split('\n').includes('overloaded')) {
            refusal('API Error: Repeated 529 Overloaded errors', 'overloaded', 529);
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
        // `delegate late:` sends the subagent's first work before `task_started`, an order the CLI does not promise to avoid.
        const late = text.startsWith('delegate late:');
        if (late || text.startsWith('delegate:')) {
            const description = text.slice(text.indexOf(':') + 1).trim();
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
            const taskStarted = (): void => {
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
            };
            if (!late) {
                taskStarted();
            }
            subagentWork('toolu_delegate', report);
            if (late) {
                taskStarted();
            }
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
        /*
         * A background agent that opens a foreground one of its own, in the order Claude Code 2.1.282 streams it:
         * the grandchild's call and result come as frames of its parent, its own steps not at all, and its
         * `task_started` says how deep it runs and nothing of whose it is.
         */
        if (text.startsWith('nested:')) {
            const summary = text.slice(7).trim() || 'done';
            const task = (frame: Record<string, unknown>): void => {
                out({ type: 'system', session_id: sessionId, ...frame });
            };
            const underMiddle = (message: Record<string, unknown>, type: 'assistant' | 'user'): void => {
                out({ type, message, parent_tool_use_id: 'toolu_middle', session_id: sessionId });
            };
            out({
                type: 'assistant',
                message: {
                    id: `msg_${nonce}_${++messageCounter}`,
                    model,
                    role: 'assistant',
                    content: [
                        {
                            type: 'tool_use',
                            id: 'toolu_middle',
                            name: 'Agent',
                            input: { description: 'middle agent', subagent_type: 'general-purpose', prompt: summary, run_in_background: true }
                        }
                    ],
                    usage
                },
                session_id: sessionId
            });
            task({
                subtype: 'task_started',
                task_id: 'a-middle',
                tool_use_id: 'toolu_middle',
                description: 'middle agent',
                subagent_type: 'general-purpose',
                is_backgrounded: true,
                spawn_depth: 1,
                task_type: 'local_agent',
                prompt: summary
            });
            out({
                type: 'user',
                message: {
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: 'toolu_middle', content: 'Async agent launched successfully.', is_error: false }]
                },
                session_id: sessionId
            });
            assistantText('sent');
            result();
            io.later(() => {
                underMiddle(
                    {
                        id: `msg_${nonce}_${++messageCounter}`,
                        model,
                        role: 'assistant',
                        content: [{ type: 'tool_use', id: 'toolu_leaf', name: 'Agent', input: { description: 'leaf agent', prompt: 'echo PONG' } }],
                        usage
                    },
                    'assistant'
                );
                task({
                    subtype: 'task_started',
                    task_id: 'a-leaf',
                    tool_use_id: 'toolu_leaf',
                    description: 'leaf agent',
                    subagent_type: 'general-purpose',
                    is_backgrounded: false,
                    spawn_depth: 2,
                    task_type: 'local_agent',
                    prompt: 'echo PONG'
                });
                task({ subtype: 'task_updated', task_id: 'a-leaf', patch: { status: 'completed', end_time: 0 } });
                task({ subtype: 'task_notification', task_id: 'a-leaf', tool_use_id: 'toolu_leaf', status: 'completed', output_file: '', summary: 'PONG' });
                underMiddle(
                    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_leaf', content: `PONG${agentFooter('a-leaf')}`, is_error: false }] },
                    'user'
                );
                underMiddle(
                    { id: `msg_${nonce}_${++messageCounter}`, model, role: 'assistant', content: [{ type: 'text', text: `the leaf said PONG` }], usage },
                    'assistant'
                );
                task({ subtype: 'task_updated', task_id: 'a-middle', patch: { status: 'completed', end_time: 0 } });
                task({
                    subtype: 'task_notification',
                    task_id: 'a-middle',
                    tool_use_id: 'toolu_middle',
                    status: 'completed',
                    output_file: '',
                    summary,
                    usage: { total_tokens: 1500, tool_uses: 1, duration_ms: 250 }
                });
                out({ type: 'system', subtype: 'init', session_id: sessionId, model, cwd: io.cwd, tools: ['Bash'], slash_commands: [], argv: args });
                assistantText(`done: ${summary}`);
                result();
            });
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
            // What the real CLI does after the turn ended: the subagent works on, and only later come a
            // notification, a fresh init, an assistant message of its own and a result, with no user frame.
            io.later(() => {
                subagentWork('toolu_agent', `the subagent says: ${summary}`);
                io.later(() => {
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
            });
            return;
        }
        /*
         * A background subagent that sends a command to the background and answers at once, the way Claude
         * Code 2.1.282 runs one: its notification opens a turn with that answer while the command runs on.
         * The command's end takes the subagent up again, which notifies once more, and only the turn that
         * opens then has what the command came to.
         */
        if (text.startsWith('background command:')) {
            // The first line only: a task brief follows it.
            const command = text.split('\n')[0]!.slice(19).trim() || 'sleep 30';
            const agentUse = 'toolu_cmd_agent';
            const bashUse = 'toolu_cmd_bash';
            const subagent = (content: unknown[]): void => {
                out({
                    type: 'assistant',
                    message: { id: `msg_${nonce}_${++messageCounter}`, model, role: 'assistant', content, usage },
                    parent_tool_use_id: agentUse,
                    session_id: sessionId
                });
            };
            const subagentResult = (toolUseId: string, content: string): void => {
                out({
                    type: 'user',
                    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: false }] },
                    parent_tool_use_id: agentUse,
                    session_id: sessionId
                });
            };
            const agentNotified = (summary: string): void => {
                out({
                    type: 'system',
                    subtype: 'task_notification',
                    task_id: 'task-cmd-agent',
                    status: 'completed',
                    output_file: '',
                    summary,
                    usage: { total_tokens: 1500, tool_uses: 1, duration_ms: 250 },
                    session_id: sessionId
                });
                out({ type: 'system', subtype: 'init', session_id: sessionId, model, cwd: io.cwd, tools: ['Bash'], slash_commands: [], argv: args });
            };
            out({
                type: 'assistant',
                message: {
                    id: `msg_${nonce}_${++messageCounter}`,
                    model,
                    role: 'assistant',
                    content: [{ type: 'tool_use', id: agentUse, name: 'Agent', input: { description: 'Run it', prompt: command, run_in_background: true } }],
                    usage
                },
                session_id: sessionId
            });
            out({
                type: 'system',
                subtype: 'task_started',
                task_id: 'task-cmd-agent',
                tool_use_id: agentUse,
                description: 'Run it',
                subagent_type: 'general-purpose',
                is_backgrounded: true,
                task_type: 'local_agent',
                session_id: sessionId
            });
            out({
                type: 'user',
                message: {
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: agentUse, content: 'Async agent launched successfully.', is_error: false }]
                },
                session_id: sessionId
            });
            assistantText('started');
            result();
            io.later(() => {
                subagent([{ type: 'tool_use', id: bashUse, name: 'Bash', input: { command, run_in_background: true } }]);
                out({
                    type: 'system',
                    subtype: 'task_started',
                    task_id: 'b-cmd',
                    tool_use_id: bashUse,
                    description: command,
                    task_type: 'local_bash',
                    is_backgrounded: true,
                    session_id: sessionId
                });
                subagentResult(bashUse, 'Command running in background with ID: b-cmd.');
                subagent([{ type: 'text', text: 'Command started in the background.' }]);
                agentNotified('Agent "Run it" finished');
                assistantText('the subagent says: Command started in the background.');
                result();
                io.later(() => {
                    out({ type: 'system', subtype: 'task_updated', task_id: 'b-cmd', patch: { status: 'completed', end_time: 30000 }, session_id: sessionId });
                    out({
                        type: 'system',
                        subtype: 'task_notification',
                        task_id: 'b-cmd',
                        tool_use_id: bashUse,
                        status: 'completed',
                        output_file: '',
                        summary: `Background command "${command}" completed (exit code 0)`,
                        session_id: sessionId
                    });
                    subagent([{ type: 'tool_use', id: 'toolu_cmd_read', name: 'Read', input: { file_path: 'b-cmd.output' } }]);
                    subagentResult('toolu_cmd_read', 'DONE');
                    subagent([{ type: 'text', text: 'The command printed DONE.' }]);
                    agentNotified('Agent "Run it" finished');
                    assistantText('the subagent reports: DONE');
                    result();
                });
            });
            return;
        }
        /*
         * A two-phase workflow, framed the way Claude Code 2.1.282 streams one: the call answers at launch,
         * and its agents send no frames of their own; only some progress frames carry a report of the whole run.
         */
        if (text.startsWith('workflow:')) {
            const summary = text.slice(9).trim() || 'Write a file, then read it';
            const task = (frame: Record<string, unknown>): void => {
                out({ type: 'system', task_id: 'wf-task', session_id: sessionId, ...frame });
            };
            const phases = [
                { type: 'workflow_phase', index: 1, title: 'Write' },
                { type: 'workflow_phase', index: 2, title: 'Read' }
            ];
            const writer = { type: 'workflow_agent', index: 1, label: 'write-file', phaseIndex: 1, phaseTitle: 'Write', agentId: 'a-writer', startedAt: 1000 };
            const reader = { type: 'workflow_agent', index: 2, label: 'read-file', phaseIndex: 2, phaseTitle: 'Read', agentId: 'a-reader', startedAt: 6000 };
            const writerDone = { ...writer, state: 'done', lastToolName: 'Write', tokens: 16264, toolCalls: 1, durationMs: 5000 };
            const progress = (description: string, report?: unknown[]): void => {
                task({
                    subtype: 'task_progress',
                    tool_use_id: 'toolu_wf',
                    description,
                    usage: { total_tokens: 16264, tool_uses: 1, duration_ms: 5000 },
                    last_tool_name: description.split(': ')[1],
                    summary,
                    ...(report === undefined ? {} : { workflow_progress: report })
                });
            };
            out({
                type: 'assistant',
                message: {
                    id: `msg_${nonce}_${++messageCounter}`,
                    model,
                    role: 'assistant',
                    content: [{ type: 'tool_use', id: 'toolu_wf', name: 'Workflow', input: { script: 'export const meta = { name: "write-and-read" }' } }],
                    usage
                },
                session_id: sessionId
            });
            out({
                type: 'system',
                subtype: 'background_tasks_changed',
                tasks: [{ task_id: 'wf-task', task_type: 'local_workflow', description: summary }],
                session_id: sessionId
            });
            task({ subtype: 'task_started', tool_use_id: 'toolu_wf', description: summary, task_type: 'local_workflow', workflow_name: 'write-and-read' });
            out({
                type: 'user',
                message: {
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: 'toolu_wf',
                            content: `Workflow launched in background. Task ID: wf-task\nSummary: ${summary}\nRun ID: wf_fake`,
                            is_error: false
                        }
                    ]
                },
                session_id: sessionId
            });
            progress('Write: write-file', [...phases, { ...writer, state: 'start' }]);
            assistantText('the workflow runs');
            result();
            io.later(() => {
                progress('Write: write-file');
                progress('Read: read-file', [...phases, writerDone, { ...reader, state: 'start' }]);
                progress('Read: read-file', [...phases, writerDone, { ...reader, state: 'done', lastToolName: 'Read', durationMs: 4000 }]);
                out({ type: 'system', subtype: 'background_tasks_changed', tasks: [], session_id: sessionId });
                task({ subtype: 'task_updated', patch: { status: 'completed', end_time: 10000 } });
                task({
                    subtype: 'task_notification',
                    tool_use_id: 'toolu_wf',
                    status: 'completed',
                    output_file: '',
                    summary: `Dynamic workflow "${summary}" completed`,
                    usage: { total_tokens: 32403, tool_uses: 2, duration_ms: 9000 }
                });
                out({ type: 'system', subtype: 'init', session_id: sessionId, model, cwd: io.cwd, tools: ['Bash'], slash_commands: [], argv: args });
                assistantText('the workflow is done');
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

/*
 * The fake, except that resuming one of `sessionIds` stops at once. `missing` is what Claude Code 2.1.281
 * does for a session it has no transcript of: one error result, a line on stderr and exit 1, before it
 * reads any input. `exit` is a CLI that did resume and then went on the first prompt.
 */
export const claudeStoppingOnResume =
    (sessionIds: ReadonlySet<string>, how: 'missing' | 'exit'): FakeCli =>
    (io) => {
        const resumeAt = io.argv.indexOf('--resume');
        const sessionId = resumeAt >= 0 ? io.argv[resumeAt + 1] : undefined;
        if (sessionId === undefined || !sessionIds.has(sessionId)) {
            return fakeClaude(io);
        }
        if (how === 'exit') {
            fakeClaude(io);
            return { onLine: () => io.exit(1) };
        }
        const message = `No conversation found with session ID: ${sessionId}`;
        io.out({
            type: 'result',
            subtype: 'error_during_execution',
            duration_ms: 0,
            is_error: true,
            num_turns: 0,
            stop_reason: null,
            session_id: sessionId,
            total_cost_usd: 0,
            usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 },
            modelUsage: {},
            permission_denials: [],
            errors: [message]
        });
        io.err(`${message}\n`);
        io.exit(1);
        return { onLine: () => undefined };
    };

if (import.meta.main) {
    await runOverStdio(fakeClaude);
}
