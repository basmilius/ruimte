/*
 * Stands in for `claude -p --input-format stream-json` in tests: speaks the same frames, needs no
 * network. `tool: <cmd>` asks for permission first, `run: <cmd>` runs without asking and reports
 * progress the way the real CLI does, `ask: <question>` asks the person a question, `compact`
 * reports a compaction, `slow` waits for an interrupt, `crash` dies. The init frame
 * carries the argument list as `argv`, so a test can see which flags a session started with.
 */
const args = process.argv.slice(2);
const resumeAt = args.indexOf('--resume');
const sessionId = resumeAt >= 0 ? args[resumeAt + 1]! : `fake-${Math.random().toString(36).slice(2, 8)}`;
const modelAt = args.indexOf('--model');
const model = modelAt >= 0 ? args[modelAt + 1]! : 'fake-model';

const out = (frame: unknown): void => {
    process.stdout.write(`${JSON.stringify(frame)}\n`);
};

let messageCounter = 0;
const usage = { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 5 };

const assistantText = (text: string): void => {
    const id = `msg_${++messageCounter}`;
    out({ type: 'stream_event', event: { type: 'message_start', message: { id, model } }, session_id: sessionId });
    out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }, session_id: sessionId });
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
    out({ type: 'assistant', message: { id, model, role: 'assistant', content: [{ type: 'thinking', thinking: '' }], usage }, session_id: sessionId });
    out({ type: 'assistant', message: { id, model, role: 'assistant', content: [{ type: 'text', text }], usage }, session_id: sessionId });
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
        modelUsage: { [model]: { contextWindow: 200000 } },
        session_id: sessionId
    });
};

let pendingApproval: { command: string } | null = null;
let pendingQuestion: string | null = null;
let slow = false;

const handleUser = (text: string): void => {
    if (text === 'crash') {
        process.exit(1);
    }
    if (text === 'slow') {
        slow = true;
        out({ type: 'stream_event', event: { type: 'message_start', message: { id: `msg_${++messageCounter}`, model } }, session_id: sessionId });
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
    if (text.startsWith('run:')) {
        const command = text.slice(4).trim();
        const id = `msg_${++messageCounter}`;
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
        const id = `msg_${++messageCounter}`;
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
    assistantText(`echo: ${text}`);
    result();
};

const handleControlResponse = (response: Record<string, unknown>): void => {
    const inner = response.response as { behavior?: string; updatedInput?: { answers?: Record<string, string> }; updatedPermissions?: unknown[] } | undefined;
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

out({ type: 'system', subtype: 'init', session_id: sessionId, model, cwd: process.cwd(), tools: ['Bash'], slash_commands: ['compact', 'review'], argv: args });

const decoder = new TextDecoder();
let buffered = '';
for await (const chunk of Bun.stdin.stream()) {
    buffered += decoder.decode(chunk, { stream: true });
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf('\n');
        if (line.trim() === '') {
            continue;
        }
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
}
process.exit(0);

export {};
