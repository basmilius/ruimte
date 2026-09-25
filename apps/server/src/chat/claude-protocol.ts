import type { ChatQuestion, ChatSubagentStatus, ChatSubagentUsage, ChatTurnLimit, ChatWorkflow, ChatWorkflowAgent, ChatWorkflowPhase } from '@ruimte/contracts';
import { readClaudeEvent } from '../usage/limits/normalize.ts';
import type { ApprovalDecision, BackendEvent } from './backend.ts';

type Frame = Record<string, unknown>;

const isRecord = (value: unknown): value is Frame => typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

// A tool result is a string or a list of content blocks; only the text is worth showing.
const resultText = (content: unknown): string => {
    if (typeof content === 'string') {
        return content;
    }
    if (!Array.isArray(content)) {
        return '';
    }
    return content
        .map((block) => (isRecord(block) && block.type === 'text' ? str(block.text) : null))
        .filter((text): text is string => text !== null)
        .join('\n');
};

// What a subagent spent, as `task_progress` and `task_notification` report it.
const taskUsage = (usage: unknown): ChatSubagentUsage | null =>
    isRecord(usage) ? { totalTokens: num(usage.total_tokens), toolUses: num(usage.tool_uses), durationMs: num(usage.duration_ms) } : null;

const contextTokens = (usage: unknown): number =>
    isRecord(usage) ? num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.cache_read_input_tokens) : 0;

// The kinds of task Claude Code keeps beside its turns that are a command or a monitor; a subagent has a row of its own.
const BACKGROUND_TASK_TYPES = new Set(['local_bash', 'monitor_mcp', 'monitor_ws']);
const ENDED_TASK_STATUSES = new Set(['completed', 'failed', 'killed', 'stopped']);

// How Claude Code (2.1.273 through 2.1.282) answers a Workflow call, with the id of the task the workflow runs as.
const WORKFLOW_LAUNCHED = /^Workflow launched in background\. Task ID: (\S+)/;

const WORKFLOW_AGENT_STATUS: Record<string, ChatSubagentStatus> = { done: 'done', error: 'failed' };

const intOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) ? value : null);

/*
 * A workflow's `workflow_progress` (Claude Code 2.1.282): every phase the script announced and every
 * agent it started so far, one entry per index, beside log lines the thread does not show. An agent
 * reads `start` while it waits and while it works, `done` or `error` once it stopped.
 */
const parseWorkflowProgress = (entries: unknown[]): Pick<ChatWorkflow, 'phases' | 'agents'> => {
    const phases = new Map<number, ChatWorkflowPhase>();
    const agents = new Map<number, ChatWorkflowAgent>();
    for (const entry of entries) {
        if (!isRecord(entry)) {
            continue;
        }
        const index = intOrNull(entry.index);
        if (index === null) {
            continue;
        }
        if (entry.type === 'workflow_phase') {
            phases.set(index, { index, title: str(entry.title) ?? '' });
        } else if (entry.type === 'workflow_agent') {
            const durationMs = intOrNull(entry.durationMs);
            agents.set(index, {
                index,
                label: str(entry.label) ?? '',
                phaseIndex: intOrNull(entry.phaseIndex),
                agentId: str(entry.agentId),
                status: WORKFLOW_AGENT_STATUS[str(entry.state) ?? ''] ?? 'running',
                startedAt: typeof entry.startedAt === 'number' ? entry.startedAt : null,
                durationMs: durationMs !== null && durationMs >= 0 ? durationMs : null,
                lastTool: str(entry.lastToolName)
            });
        }
    }
    const byIndex = (a: { index: number }, b: { index: number }): number => a.index - b.index;
    return { phases: [...phases.values()].sort(byIndex), agents: [...agents.values()].sort(byIndex) };
};

// The CLI's AskUserQuestion input, as far as the person needs to see it.
const parseQuestions = (input: unknown): ChatQuestion[] => {
    if (!isRecord(input) || !Array.isArray(input.questions)) {
        return [];
    }
    return input.questions.filter(isRecord).map((question, index) => ({
        id: String(index),
        header: str(question.header) ?? '',
        question: str(question.question) ?? '',
        choices: Array.isArray(question.options)
            ? question.options.filter(isRecord).map((option) => ({ label: str(option.label) ?? '', description: str(option.description) ?? '' }))
            : [],
        multiSelect: question.multiSelect === true
    }));
};

// What the CLI waits for on stdin, kept until `chat.approve` or `chat.answer` names the request.
type Pending =
    | { type: 'approval'; toolUseId: string | null; input: unknown; suggestions: unknown[] }
    | { type: 'question'; toolUseId: string | null; input: unknown };

/*
 * Claude Code's stream-json frames, in and out. Text is keyed by message id plus the ordinal of the
 * text block inside that message, because the streaming events and the final `assistant` frames
 * number their blocks differently (the final frames arrive one block at a time). One instance
 * belongs to one process, so a resumed CLI that numbers its messages from the start gets its own.
 */
export class ClaudeProtocol {
    private readonly pending = new Map<string, Pending>();
    private streamMessageId: string | null = null;
    private streamTextCount = 0;
    private streamThinkingCount = 0;
    // Stream block index to the ref of the text block collecting its deltas.
    private readonly streamBlocks = new Map<number, string>();
    private readonly frameTextCount = new Map<string, number>();
    private readonly frameThinkingCount = new Map<string, number>();
    // Commands started in the foreground, which the CLI may still send to the background, and what runs there now.
    private readonly foregroundShells = new Map<string, { ref: string | null; description: string | null }>();
    private readonly backgroundTasks = new Set<string>();
    // Workflows still running, by task id, to the Workflow call that launched each.
    private readonly workflows = new Map<string, string>();
    // The uuid of the last main-chain assistant frame of the turn, which is the line of the transcript the turn ends on.
    private lastUuid: string | null = null;
    // What this turn heard about a limit: the API error of a main-chain frame, and a window the plan refused, with its reset in seconds.
    private apiError: string | null = null;
    private refused: { resetsAt: number | null } | null = null;

    handle(frame: unknown): BackendEvent[] {
        const events: BackendEvent[] = [];
        if (!isRecord(frame)) {
            return events;
        }
        switch (frame.type) {
            case 'system':
                this.handleSystem(frame, events);
                break;
            case 'stream_event':
                this.handleStreamEvent(frame, events);
                break;
            case 'assistant':
                this.handleAssistant(frame, events);
                break;
            case 'user':
                this.handleUser(frame, events);
                break;
            case 'result':
                this.handleResult(frame, events);
                break;
            case 'control_request':
                this.handleControlRequest(frame, events);
                break;
            case 'control_cancel_request': {
                const requestId = str(frame.request_id);
                if (requestId) {
                    this.pending.delete(requestId);
                    events.push({ type: 'request.withdrawn', requestId });
                }
                break;
            }
            case 'tool_progress':
                this.handleToolProgress(frame, events);
                break;
            case 'rate_limit_event': {
                this.noteRefusal(frame.rate_limit_info);
                // The plan's own numbers, streamed while a turn runs; the usage monitor keeps them.
                const update = readClaudeEvent(frame.rate_limit_info);
                if (update !== null) {
                    events.push({ type: 'limits', update });
                }
                break;
            }
            default:
                break;
        }
        return events;
    }

    /* The `control_response` that answers a permission request, or null when nothing waits under that id. */
    approvalResponse(requestId: string, decision: ApprovalDecision, message?: string): unknown | null {
        const pending = this.pending.get(requestId);
        if (pending?.type !== 'approval') {
            return null;
        }
        this.pending.delete(requestId);
        const toolUseID = pending.toolUseId ?? undefined;
        const response =
            decision === 'deny'
                ? { behavior: 'deny', message: message?.trim() || 'The user declined this action', toolUseID }
                : {
                      behavior: 'allow',
                      updatedInput: pending.input,
                      toolUseID,
                      // The CLI's own suggestion of a rule; sending it back is what makes "always" stick.
                      ...(decision === 'allow-always' && pending.suggestions.length > 0 ? { updatedPermissions: pending.suggestions } : {})
                  };
        return { type: 'control_response', response: { subtype: 'success', request_id: requestId, response } };
    }

    /* The `control_response` that answers an AskUserQuestion, or null when nothing waits under that id. */
    questionResponse(requestId: string, answers: Record<string, string>): unknown | null {
        const pending = this.pending.get(requestId);
        if (pending?.type !== 'question') {
            return null;
        }
        this.pending.delete(requestId);
        // The CLI keys answers by the question text, the client by the question's id.
        const byText: Record<string, string> = {};
        for (const question of parseQuestions(pending.input)) {
            const given = answers[question.id];
            if (given !== undefined) {
                byText[question.question] = given;
            }
        }
        const input = isRecord(pending.input) ? pending.input : {};
        return {
            type: 'control_response',
            response: {
                subtype: 'success',
                request_id: requestId,
                response: { behavior: 'allow', updatedInput: { ...input, answers: byText }, toolUseID: pending.toolUseId ?? undefined }
            }
        };
    }

    /* The `control_response` that turns down an approval or a question the CLI still holds, or null when nothing waits under that id. */
    declineResponse(requestId: string, message: string): unknown | null {
        const pending = this.pending.get(requestId);
        if (pending === undefined) {
            return null;
        }
        this.pending.delete(requestId);
        return {
            type: 'control_response',
            response: { subtype: 'success', request_id: requestId, response: { behavior: 'deny', message, toolUseID: pending.toolUseId ?? undefined } }
        };
    }

    forgetPending(): void {
        this.pending.clear();
    }

    private handleSystem(frame: Frame, events: BackendEvent[]): void {
        if (frame.subtype === 'init') {
            const commands = Array.isArray(frame.slash_commands)
                ? frame.slash_commands.filter((command): command is string => typeof command === 'string')
                : [];
            const skills = Array.isArray(frame.skills) ? frame.skills.filter((skill): skill is string => typeof skill === 'string') : [];
            events.push({ type: 'session', agentSessionId: str(frame.session_id), model: str(frame.model), slashCommands: commands, skills });
        } else if (frame.subtype === 'task_started') {
            this.handleTaskStarted(frame, events);
        } else if (frame.subtype === 'task_updated') {
            this.handleTaskUpdated(frame, events);
        } else if (frame.subtype === 'task_progress') {
            const ref = str(frame.tool_use_id);
            if (!ref) {
                return;
            }
            // Only some of a workflow's progress frames carry it; the rest only count what it spent.
            if (Array.isArray(frame.workflow_progress)) {
                events.push({ type: 'workflow.progress', ref, workflow: { name: null, ...parseWorkflowProgress(frame.workflow_progress) } });
            }
            // Only a subagent reports what it spent; a task without that is a command with a description.
            if (frame.task_type === 'local_agent' || str(frame.subagent_type)) {
                events.push({
                    type: 'task.progress',
                    ref,
                    taskId: str(frame.task_id),
                    summary: str(frame.description),
                    lastTool: str(frame.last_tool_name),
                    usage: taskUsage(frame.usage)
                });
            } else {
                const description = str(frame.description);
                if (description) {
                    events.push({ type: 'tool.progress', ref, startedAt: null, description });
                }
            }
        } else if (frame.subtype === 'task_notification') {
            const taskId = str(frame.task_id);
            if (taskId) {
                this.endBackground(taskId, events);
                this.workflows.delete(taskId);
            }
            // The CLI wakes the main agent itself when a background task settles; this frame is the only
            // thing that says what it was about, and it arrives before the turn nobody asked for.
            events.push({
                type: 'task.done',
                ref: str(frame.tool_use_id),
                taskId,
                summary: str(frame.summary),
                ok: str(frame.status) === 'completed',
                usage: taskUsage(frame.usage),
                outputFile: str(frame.output_file) || null
            });
        } else if (frame.subtype === 'compact_boundary') {
            const meta = isRecord(frame.compact_metadata) ? frame.compact_metadata : {};
            const preTokens = num(meta.pre_tokens);
            events.push({ type: 'compaction', preTokens: preTokens > 0 ? preTokens : null });
        }
    }

    private handleTaskStarted(frame: Frame, events: BackendEvent[]): void {
        const ref = str(frame.tool_use_id);
        if (frame.task_type === 'local_agent') {
            if (ref) {
                events.push({
                    type: 'task.started',
                    ref,
                    taskId: str(frame.task_id),
                    description: str(frame.description),
                    subagentType: str(frame.subagent_type),
                    prompt: str(frame.prompt),
                    background: frame.is_backgrounded === true,
                    ...(typeof frame.spawn_depth === 'number' ? { depth: frame.spawn_depth } : {})
                });
            }
            return;
        }
        const taskId = str(frame.task_id);
        const description = str(frame.description);
        if (taskId && ref && frame.task_type === 'local_workflow') {
            this.workflows.set(taskId, ref);
            events.push({ type: 'workflow.progress', ref, workflow: { name: str(frame.workflow_name), phases: [], agents: [] } });
        }
        if (taskId && typeof frame.task_type === 'string' && BACKGROUND_TASK_TYPES.has(frame.task_type) && frame.ambient !== true) {
            if (frame.is_backgrounded === false) {
                this.foregroundShells.set(taskId, { ref, description });
            } else {
                this.startBackground(taskId, ref, frame.task_type !== 'local_bash', description, events);
            }
        }
        // A Bash call became a task; its description is the CLI's own words for the work.
        if (ref && description) {
            events.push({ type: 'tool.progress', ref, startedAt: null, description });
        }
    }

    /* A command the person or the CLI sent to the background halfway, or a task that ended. */
    private handleTaskUpdated(frame: Frame, events: BackendEvent[]): void {
        const taskId = str(frame.task_id);
        const patch = isRecord(frame.patch) ? frame.patch : {};
        if (!taskId) {
            return;
        }
        const shell = this.foregroundShells.get(taskId);
        if (shell && patch.is_backgrounded === true) {
            this.foregroundShells.delete(taskId);
            this.startBackground(taskId, shell.ref, false, str(patch.description) ?? shell.description, events);
        }
        const status = str(patch.status);
        if (status !== null && ENDED_TASK_STATUSES.has(status)) {
            this.foregroundShells.delete(taskId);
            this.endBackground(taskId, events);
            this.endWorkflow(taskId, null, status === 'completed', events);
        }
    }

    private startBackground(taskId: string, ref: string | null, monitor: boolean, description: string | null, events: BackendEvent[]): void {
        if (this.backgroundTasks.has(taskId)) {
            return;
        }
        this.backgroundTasks.add(taskId);
        events.push({ type: 'background.started', taskId, ref, monitor, description });
    }

    private endBackground(taskId: string, events: BackendEvent[]): void {
        if (this.backgroundTasks.delete(taskId)) {
            events.push({ type: 'background.ended', taskId });
        }
    }

    /*
     * A workflow that ended, told by either its notification or the task's own status, whichever comes
     * first: the stream of a workflow run was not seen live, and both are what every other task sends.
     */
    private endWorkflow(taskId: string, summary: string | null, ok: boolean, events: BackendEvent[]): void {
        const ref = this.workflows.get(taskId);
        if (ref === undefined) {
            return;
        }
        this.workflows.delete(taskId);
        events.push({ type: 'task.done', ref, taskId, summary, ok });
    }

    /* The control request that ends one task the CLI runs beside its turns. */
    stopTaskRequest(taskId: string): unknown {
        return { type: 'control_request', request_id: `stop-task-${taskId}-${Date.now()}`, request: { subtype: 'stop_task', task_id: taskId } };
    }

    private handleStreamEvent(frame: Frame, events: BackendEvent[]): void {
        const event = frame.event;
        if (!isRecord(event) || str(frame.parent_tool_use_id)) {
            return;
        }
        if (event.type === 'message_start') {
            const message = isRecord(event.message) ? event.message : {};
            this.streamMessageId = str(message.id);
            this.streamTextCount = 0;
            this.streamThinkingCount = 0;
            this.streamBlocks.clear();
            return;
        }
        const index = num(event.index);
        if (event.type === 'content_block_start' && isRecord(event.content_block) && this.streamMessageId) {
            if (event.content_block.type === 'text') {
                const ref = this.textRef(this.streamMessageId, this.streamTextCount++);
                this.streamBlocks.set(index, ref);
                events.push({ type: 'text.delta', ref, text: str(event.content_block.text) ?? '' });
                return;
            }
            if (event.content_block.type === 'thinking') {
                const ref = this.thinkingRef(this.streamMessageId, this.streamThinkingCount++);
                this.streamBlocks.set(index, ref);
                events.push({ type: 'thinking.delta', ref, text: str(event.content_block.thinking) ?? '' });
                return;
            }
        }
        if (event.type === 'content_block_delta' && isRecord(event.delta)) {
            const ref = this.streamBlocks.get(index);
            const text = str(event.delta.text) ?? str(event.delta.thinking);
            if (!ref || !text) {
                return;
            }
            if (event.delta.type === 'text_delta') {
                events.push({ type: 'text.delta', ref, text });
            } else if (event.delta.type === 'thinking_delta') {
                events.push({ type: 'thinking.delta', ref, text });
            }
        }
    }

    private handleAssistant(frame: Frame, events: BackendEvent[]): void {
        const message = isRecord(frame.message) ? frame.message : {};
        const messageId = str(message.id) ?? 'message';
        const parentRef = str(frame.parent_tool_use_id);
        const content = Array.isArray(message.content) ? message.content : [];
        const uuid = str(frame.uuid);
        if (!parentRef && uuid) {
            this.lastUuid = uuid;
        }
        if (!parentRef && typeof frame.error === 'string') {
            this.apiError = frame.error;
        }
        for (const block of content) {
            if (!isRecord(block)) {
                continue;
            }
            if (block.type === 'text') {
                const ordinal = this.frameTextCount.get(messageId) ?? 0;
                this.frameTextCount.set(messageId, ordinal + 1);
                // A subagent's text is its own report, not the thread's answer; the parent says whose row it is.
                events.push({ type: 'text.done', ref: this.textRef(messageId, ordinal), text: str(block.text) ?? '', ...(parentRef ? { parentRef } : {}) });
            } else if (block.type === 'thinking' && !parentRef) {
                const ordinal = this.frameThinkingCount.get(messageId) ?? 0;
                this.frameThinkingCount.set(messageId, ordinal + 1);
                events.push({ type: 'thinking.done', ref: this.thinkingRef(messageId, ordinal), text: str(block.thinking) ?? '' });
            } else if (block.type === 'tool_use') {
                events.push({
                    type: 'tool.started',
                    ref: str(block.id) ?? `tool-${Date.now()}`,
                    name: str(block.name) ?? 'tool',
                    input: block.input ?? {},
                    parentRef
                });
            }
        }
        const tokens = parentRef ? 0 : contextTokens(message.usage);
        if (tokens > 0) {
            events.push({ type: 'usage', contextTokens: tokens });
        }
        const error = str(frame.error);
        if (error) {
            events.push({ type: 'note', level: 'error', text: `The request failed: ${error.replaceAll('_', ' ')}` });
        }
    }

    /*
     * `tool_progress` carries how long the call has run (once per 30 s for a Bash under the CLI's
     * remote gate, or a heartbeat for a slow MCP tool); the start is kept so the client can count on.
     * That gate is `CLAUDE_CODE_REMOTE` or `CLAUDE_CODE_CONTAINER_ID`, never set here since both change other behavior.
     */
    private handleToolProgress(frame: Frame, events: BackendEvent[]): void {
        const elapsed = frame.elapsed_time_seconds;
        const ref = str(frame.tool_use_id);
        if (!ref || typeof elapsed !== 'number' || !Number.isFinite(elapsed) || elapsed < 0) {
            return;
        }
        events.push({ type: 'tool.progress', ref, startedAt: Date.now() - Math.round(elapsed * 1000), description: null });
    }

    private handleUser(frame: Frame, events: BackendEvent[]): void {
        const message = isRecord(frame.message) ? frame.message : {};
        const content = Array.isArray(message.content) ? message.content : [];
        for (const block of content) {
            if (!isRecord(block) || block.type !== 'tool_result') {
                continue;
            }
            const ref = str(block.tool_use_id);
            if (ref) {
                const output = resultText(block.content);
                const workflow = WORKFLOW_LAUNCHED.exec(output)?.[1];
                if (workflow) {
                    this.workflows.set(workflow, ref);
                }
                events.push({ type: 'tool.done', ref, output, state: block.is_error === true ? 'error' : 'done' });
            }
        }
    }

    private handleResult(frame: Frame, events: BackendEvent[]): void {
        const failed = frame.is_error === true || (typeof frame.subtype === 'string' && frame.subtype.startsWith('error'));
        const errors = Array.isArray(frame.errors) ? frame.errors.filter((error): error is string => typeof error === 'string') : [];
        const lastUuid = this.lastUuid;
        this.lastUuid = null;
        const limit = failed ? this.limit() : null;
        this.apiError = null;
        this.refused = null;
        events.push({
            type: 'turn.done',
            state: failed ? 'error' : 'done',
            costUsd: num(frame.total_cost_usd),
            ...(failed ? { error: errors[0] ?? str(frame.result) ?? `The turn ended with ${str(frame.subtype) ?? 'an error'}` } : {}),
            ...(lastUuid === null ? {} : { native: { lastUuid } }),
            ...(limit === null ? {} : { limit })
        });
    }

    /* The last word of the plan on its windows this turn: `rejected` is a window that refused the request. */
    private noteRefusal(info: unknown): void {
        if (!isRecord(info) || typeof info.status !== 'string') {
            return;
        }
        this.refused = info.status === 'rejected' ? { resetsAt: typeof info.resetsAt === 'number' ? info.resetsAt : null } : null;
    }

    /*
     * What stopped a failed turn, in the words of Claude Code 2.1.281: a window of the plan that refused
     * the request is a usage limit, and an API error of `rate_limit` without one (a 429 the plan did
     * not explain) or of `overloaded` is a model too busy to answer.
     */
    private limit(): ChatTurnLimit | null {
        if (this.refused !== null) {
            return { kind: 'usage', ...(this.refused.resetsAt === null ? {} : { resetsAt: this.refused.resetsAt * 1000 }) };
        }
        if (this.apiError === 'rate_limit' || this.apiError === 'overloaded') {
            return { kind: 'overload' };
        }
        return null;
    }

    private handleControlRequest(frame: Frame, events: BackendEvent[]): void {
        const request = isRecord(frame.request) ? frame.request : {};
        const requestId = str(frame.request_id);
        if (!requestId || request.subtype !== 'can_use_tool') {
            return;
        }
        const toolUseId = str(request.tool_use_id);
        const toolName = str(request.tool_name) ?? 'tool';
        if (toolName === 'AskUserQuestion') {
            const questions = parseQuestions(request.input);
            if (questions.length === 0) {
                return;
            }
            this.pending.set(requestId, { type: 'question', toolUseId, input: request.input });
            events.push({ type: 'question.requested', requestId, questions });
            return;
        }
        const suggestions = Array.isArray(request.permission_suggestions) ? request.permission_suggestions : [];
        this.pending.set(requestId, { type: 'approval', toolUseId, input: request.input ?? {}, suggestions });
        events.push({
            type: 'approval.requested',
            requestId,
            ref: toolUseId,
            toolName,
            input: request.input ?? {},
            description: str(request.description),
            canAllowAlways: suggestions.length > 0,
            ...(suggestions.length > 0 ? { allowAlways: { label: 'Allow with these rules', description: JSON.stringify(suggestions, null, 2) } } : {})
        });
    }

    private textRef(messageId: string, ordinal: number): string {
        return `${messageId}:t${ordinal}`;
    }

    private thinkingRef(messageId: string, ordinal: number): string {
        return `${messageId}:k${ordinal}`;
    }
}
